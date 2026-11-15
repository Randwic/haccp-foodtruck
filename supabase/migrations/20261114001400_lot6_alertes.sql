-- =============================================================================
-- HACCP Food Truck — lot 6 (capteurs, alertes, notifications)
--  0. Réglages : settings.sensor_silent_minutes (60), settings.alert_repeat_minutes (15)
--  1. Capteurs fixes (`sensors`) : référence gérée par le gérant (même régime que
--     suppliers), jeton d'envoi propre à chaque capteur dont seul le SHA-256 est
--     stocké ; création / renouvellement du jeton par sensor_create() /
--     sensor_rotate_token() (gérant, jeton affiché une seule fois).
--  2. Mesures (`sensor_readings`) : insertion seule (comme records), écrites
--     uniquement par sensor_record_reading() (Edge Function sensor-ingest) avec
--     limite de débit par capteur ; purge par la durée de conservation.
--  3. Alertes (`alerts`) : insertion + mises à jour contrôlées (résolution, prise
--     en compte, dernière notification), jamais de suppression ; une seule alerte
--     ouverte par sujet ; prise en compte posée à l'insertion d'un record
--     `alert_ack` (trigger, même transaction).
--  4. Abonnements Web Push (`push_subscriptions`).
--  Le type `alert_ack` figure déjà dans haccp_known_record_type().
--  Migration idempotente (rejouable).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Réglages des alertes (DEFAULT_ALERT_SETTINGS de shared/payloads.ts)
-- ---------------------------------------------------------------------------
alter table public.settings
  add column if not exists sensor_silent_minutes integer not null default 60,
  add column if not exists alert_repeat_minutes  integer not null default 15;
do $$ begin
  alter table public.settings add constraint settings_alert_ranges
    check (sensor_silent_minutes between 15 and 1440 and alert_repeat_minutes between 5 and 1440);
exception when duplicate_object then null; end $$;
comment on column public.settings.sensor_silent_minutes is
  'Capteur considéré muet (alerte sensor_silent) sans mesure depuis ce nombre de minutes (15..1440).';
comment on column public.settings.alert_repeat_minutes is
  'Rappel (Web Push) d''une alerte ouverte non prise en compte au plus toutes les N minutes (5..1440).';

-- ---------------------------------------------------------------------------
-- 1. Capteurs
-- ---------------------------------------------------------------------------
create table if not exists public.sensors (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  equipment_id     uuid not null references public.equipment (id) on delete restrict,
  vendor           text not null default 'shelly_ht',
  active           boolean not null default true,
  -- SHA-256 hex du jeton d'envoi : jamais lisible par le gérant (privilèges de colonne).
  token_hash       text not null unique,
  last_seen_at     timestamptz null,
  last_value_c     numeric(4, 1) null,
  battery_percent  smallint null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sensors_name_check       check (public.haccp_valid_ref_name(name)),
  constraint sensors_vendor_check     check (vendor in ('shelly_ht', 'thermoworks_node', 'tempstick', 'generic')),
  constraint sensors_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint sensors_value_check      check (last_value_c is null or last_value_c between -60 and 100),
  constraint sensors_battery_check    check (battery_percent is null or battery_percent between 0 and 100)
);
comment on table public.sensors is
  'Capteurs fixes (lot 6). Jeton d''envoi : seul son SHA-256 est stocké (token_hash, jamais lisible par le gérant). '
  'Création : sensor_create() ; jamais supprimés, désactiver avec active = false.';

drop trigger if exists sensors_updated_at on public.sensors;
create trigger sensors_updated_at before insert or update on public.sensors
  for each row execute function public.haccp_set_updated_at();
-- Audit : création / modification par le gérant ; les mises à jour de télémétrie seules
-- (last_seen_at, last_value_c, battery_percent) ne sont pas journalisées.
drop trigger if exists sensors_audit on public.sensors;
drop trigger if exists sensors_audit_ins_del on public.sensors;
create trigger sensors_audit_ins_del after insert or delete on public.sensors
  for each row execute function public.haccp_audit();
drop trigger if exists sensors_audit_upd on public.sensors;
create trigger sensors_audit_upd after update on public.sensors
  for each row
  when ((to_jsonb(old) - '{last_seen_at,last_value_c,battery_percent,updated_at}'::text[])
        is distinct from (to_jsonb(new) - '{last_seen_at,last_value_c,battery_percent,updated_at}'::text[]))
  execute function public.haccp_audit();
drop trigger if exists sensors_no_delete on public.sensors;
create trigger sensors_no_delete before delete on public.sensors
  for each row execute function public.haccp_reference_no_delete();
drop trigger if exists sensors_no_truncate on public.sensors;
create trigger sensors_no_truncate before truncate on public.sensors
  for each statement execute function public.haccp_reference_no_delete();

-- Privilèges : le gérant lit / écrit tout SAUF token_hash (lecture et écriture interdites) ;
-- les Edge Functions lisent (sensor-ingest retrouve le capteur par token_hash) et n'écrivent
-- la télémétrie que par sensor_record_reading().
revoke all on public.sensors from public, anon, authenticated, service_role;
grant select (id, name, equipment_id, vendor, active, last_seen_at, last_value_c, battery_percent, created_at, updated_at)
  on public.sensors to authenticated;
grant insert (name, equipment_id, vendor, active), update (name, equipment_id, vendor, active)
  on public.sensors to authenticated;
grant select on public.sensors to service_role;

alter table public.sensors enable row level security;
drop policy if exists manager_read   on public.sensors;
drop policy if exists manager_insert on public.sensors;
drop policy if exists manager_update on public.sensors;
create policy manager_read   on public.sensors for select to authenticated using (public.is_manager());
create policy manager_insert on public.sensors for insert to authenticated with check (public.is_manager());
create policy manager_update on public.sensors for update to authenticated using (public.is_manager()) with check (public.is_manager());

-- Jeton d'envoi : 2 × gen_random_uuid() (générateur fort de PostgreSQL, 244 bits aléatoires)
-- → 32 octets → 43 caractères base64url. Seul son SHA-256 hex est stocké.
create or replace function public.haccp_new_sensor_token()
returns text
language sql
volatile
set search_path = pg_catalog
as $$
  select rtrim(translate(encode(decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/', '-_'), '=');
$$;

-- Création d'un capteur par le gérant. Renvoie le jeton UNE SEULE FOIS (à recopier dans
-- l'URL du webhook du capteur). Appel depuis l'app : supabase.rpc('sensor_create', {...}).
create or replace function public.sensor_create(p_name text, p_equipment_id uuid, p_vendor text default 'shelly_ht')
returns table (sensor_id uuid, sensor_token text)
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_token text := public.haccp_new_sensor_token();
  v_id    uuid;
begin
  if not public.is_manager() then
    raise exception 'HACCP: forbidden — réservé au gérant' using errcode = 'insufficient_privilege';
  end if;
  insert into public.sensors (name, equipment_id, vendor, token_hash)
  values (btrim(p_name), p_equipment_id, coalesce(p_vendor, 'shelly_ht'), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
  returning id into v_id;
  return query select v_id, v_token;
end;
$$;

-- Nouveau jeton (ancien jeton invalidé immédiatement), affiché une seule fois.
create or replace function public.sensor_rotate_token(p_sensor_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_token text := public.haccp_new_sensor_token();
begin
  if not public.is_manager() then
    raise exception 'HACCP: forbidden — réservé au gérant' using errcode = 'insufficient_privilege';
  end if;
  update public.sensors set token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex') where id = p_sensor_id;
  if not found then
    raise exception 'HACCP: unknown_sensor — capteur % inconnu', p_sensor_id using errcode = 'no_data_found';
  end if;
  return v_token;
end;
$$;

revoke all on function public.haccp_new_sensor_token() from public, anon, authenticated, service_role;
revoke all on function public.sensor_create(text, uuid, text) from public, anon, service_role;
revoke all on function public.sensor_rotate_token(uuid) from public, anon, service_role;
grant execute on function public.sensor_create(text, uuid, text) to authenticated;
grant execute on function public.sensor_rotate_token(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Mesures des capteurs : insertion seule
-- ---------------------------------------------------------------------------
create table if not exists public.sensor_readings (
  id               bigserial primary key,
  sensor_id        uuid not null references public.sensors (id) on delete restrict,
  measured_at      timestamptz not null,
  value_c          numeric(4, 1) not null,
  battery_percent  smallint null,
  received_at      timestamptz not null default now(),
  constraint sensor_readings_value_check    check (value_c between -60 and 100),
  constraint sensor_readings_battery_check  check (battery_percent is null or battery_percent between 0 and 100),
  -- Heure de mesure plausible : au plus 5 min dans le futur, au plus 24 h dans le passé.
  constraint sensor_readings_measured_check check (measured_at <= received_at + interval '5 minutes'
                                                   and measured_at >= received_at - interval '1 day')
);
create index if not exists sensor_readings_sensor_time_idx on public.sensor_readings (sensor_id, measured_at desc);
create index if not exists sensor_readings_received_idx on public.sensor_readings (received_at);
comment on table public.sensor_readings is
  'Mesures des capteurs (lot 6), insertion seule. Écrites par sensor_record_reading() ; supprimées seulement par purge_sensor_readings() (durée de conservation).';

create or replace function public.haccp_sensor_readings_before_insert()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.received_at := now();
  return new;
end;
$$;

-- Garde « insertion seule » : UPDATE / TRUNCATE toujours refusés ; DELETE seulement pendant
-- purge_sensor_readings() (indicateur local + propriétaire de la table) et pour une ligne expirée.
create or replace function public.haccp_sensor_readings_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_years integer;
begin
  if tg_op = 'DELETE'
     and coalesce(current_setting('haccp.purge_in_progress', true), '') = 'on'
     and current_user = (select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = tg_relid) then
    select s.retention_years into v_years from public.settings s where s.id = 1;
    if v_years is not null and old.received_at < now() - make_interval(years => v_years) then
      return old;
    end if;
    raise exception 'HACCP: purge refusée, mesure % non expirée', old.id using errcode = 'insufficient_privilege';
  end if;
  raise exception 'HACCP: % interdit sur %.% (mesures en insertion seule)', tg_op, tg_table_schema, tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists sensor_readings_before_insert on public.sensor_readings;
create trigger sensor_readings_before_insert before insert on public.sensor_readings
  for each row execute function public.haccp_sensor_readings_before_insert();
drop trigger if exists sensor_readings_no_update on public.sensor_readings;
create trigger sensor_readings_no_update before update on public.sensor_readings
  for each row execute function public.haccp_sensor_readings_guard();
drop trigger if exists sensor_readings_no_delete on public.sensor_readings;
create trigger sensor_readings_no_delete before delete on public.sensor_readings
  for each row execute function public.haccp_sensor_readings_guard();
drop trigger if exists sensor_readings_no_truncate on public.sensor_readings;
create trigger sensor_readings_no_truncate before truncate on public.sensor_readings
  for each statement execute function public.haccp_sensor_readings_guard();

revoke all on public.sensor_readings from public, anon, authenticated, service_role;
revoke all on sequence public.sensor_readings_id_seq from public, anon, authenticated, service_role;
grant select on public.sensor_readings to authenticated, service_role;
alter table public.sensor_readings enable row level security;
drop policy if exists manager_read on public.sensor_readings;
create policy manager_read on public.sensor_readings for select to authenticated using (public.is_manager());

-- Enregistre une mesure (Edge Function sensor-ingest, service_role) — tout ou rien :
-- verrou par capteur, limite de débit (≥ p_min_interval_seconds entre deux mesures stockées,
-- jugée sur last_seen_at), insertion, mise à jour de la télémétrie du capteur.
-- Résultat : 'stored' | 'rate_limited' | 'inactive' | 'unknown_sensor'.
create or replace function public.sensor_record_reading(
  p_sensor_id uuid, p_measured_at timestamptz, p_value_c numeric, p_battery_percent integer default null,
  p_min_interval_seconds integer default 30
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_active    boolean;
  v_last_seen timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('haccp-sensor:' || p_sensor_id::text, 0));
  select s.active, s.last_seen_at into v_active, v_last_seen from public.sensors s where s.id = p_sensor_id for no key update;
  if not found then return 'unknown_sensor'; end if;
  if not v_active then return 'inactive'; end if;
  if v_last_seen is not null
     and v_last_seen > now() - make_interval(secs => greatest(coalesce(p_min_interval_seconds, 30), 30)) then
    return 'rate_limited';
  end if;
  insert into public.sensor_readings (sensor_id, measured_at, value_c, battery_percent)
  values (p_sensor_id, coalesce(p_measured_at, now()), round(p_value_c, 1), p_battery_percent);
  update public.sensors
     set last_seen_at = now(),
         last_value_c = round(p_value_c, 1),
         battery_percent = coalesce(p_battery_percent, battery_percent)
   where id = p_sensor_id;
  return 'stored';
end;
$$;
revoke all on function public.sensor_record_reading(uuid, timestamptz, numeric, integer, integer) from public, anon, authenticated;
grant execute on function public.sensor_record_reading(uuid, timestamptz, numeric, integer, integer) to service_role;

-- Purge des mesures arrivées en fin de conservation (settings.retention_years, comme records).
create or replace function public.purge_sensor_readings()
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_years  integer;
  v_cutoff timestamptz;
  v_count  bigint;
begin
  select s.retention_years into v_years from public.settings s where s.id = 1;
  if v_years is null then
    raise exception 'HACCP: purge impossible, paramètres (settings id = 1) absents';
  end if;
  v_cutoff := now() - make_interval(years => v_years);
  perform pg_advisory_xact_lock(hashtextextended('haccp-purge-sensor-readings', 0));
  perform set_config('haccp.purge_in_progress', 'on', true);
  delete from public.sensor_readings r where r.received_at < v_cutoff;
  get diagnostics v_count = row_count;
  perform set_config('haccp.purge_in_progress', 'off', true);
  insert into public.audit_log (actor, table_name, row_id, action, old, new)
  values ('system:purge', 'sensor_readings', null, 'PURGE', null,
          jsonb_build_object('deleted', v_count, 'retention_years', v_years, 'cutoff', v_cutoff));
  return v_count;
end;
$$;
revoke all on function public.purge_sensor_readings() from public, anon, authenticated;
grant execute on function public.purge_sensor_readings() to service_role;

-- Planification quotidienne (03:27 UTC), tolérante comme …0500 : sans pg_cron, simple avertissement.
-- À relancer si pg_cron est activé plus tard :
--   select cron.schedule('haccp-purge-sensor-readings', '27 3 * * *', 'select public.purge_sensor_readings()');
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('haccp-purge-sensor-readings', '27 3 * * *', 'select public.purge_sensor_readings()');
    exception when others then
      raise warning 'HACCP: planification pg_cron de la purge des mesures impossible (%)', sqlerrm;
    end;
  else
    raise warning 'HACCP: extension pg_cron absente, purge des mesures non planifiée';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Alertes : jamais supprimées ; seules résolution, prise en compte et dernière
--    notification évoluent (horodatages imposés par le serveur, à sens unique).
-- ---------------------------------------------------------------------------
create table if not exists public.alerts (
  id                         uuid primary key default gen_random_uuid(),
  kind                       text not null,
  equipment_id               uuid null references public.equipment (id) on delete restrict,
  sensor_id                  uuid null references public.sensors (id) on delete restrict,
  -- Pas de clé étrangère : le registre peut être purgé, l'alerte reste.
  related_record_id          uuid null,
  message                    text not null,
  opened_at                  timestamptz not null default now(),
  resolved_at                timestamptz null,
  acknowledged_at            timestamptz null,
  -- Enregistrement `alert_ack` qui a pris l'alerte en compte (traçabilité, hors contrat Alert).
  acknowledged_by_record_id  uuid null,
  last_notified_at           timestamptz null,
  updated_at                 timestamptz not null default now(),
  constraint alerts_kind_check check (kind in ('sensor_out_of_range', 'sensor_silent', 'sensor_battery_low',
                                               'check_overdue', 'process_overdue', 'corrective_action_missing')),
  constraint alerts_message_check check (char_length(btrim(message)) between 1 and 300 and char_length(message) <= 300),
  -- Sujet exigé selon la nature de l'alerte.
  constraint alerts_subject_check check (
    case
      when kind like 'sensor\_%' then sensor_id is not null
      when kind = 'check_overdue' then equipment_id is not null
      else related_record_id is not null
    end),
  constraint alerts_resolved_check check (resolved_at is null or resolved_at >= opened_at)
);
-- Une seule alerte OUVERTE par sujet (kind, équipement, capteur, enregistrement ; null = null).
create unique index if not exists alerts_one_open_idx
  on public.alerts (kind, equipment_id, sensor_id, related_record_id) nulls not distinct
  where resolved_at is null;
create index if not exists alerts_updated_idx on public.alerts (updated_at);
comment on table public.alerts is
  'Alertes calculées par alerts-evaluate (lot 6). Jamais supprimées ; seules resolved_at, acknowledged_at (record alert_ack) '
  'et last_notified_at évoluent, une seule fois pour les deux premières, horodatées par le serveur.';

create or replace function public.haccp_alerts_guard()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'HACCP: % interdit sur les alertes (jamais supprimées)', tg_op using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if new.resolved_at is not null or new.acknowledged_at is not null or new.acknowledged_by_record_id is not null
       or new.last_notified_at is not null then
      raise exception 'HACCP: alert_insert — une alerte est créée ouverte, non prise en compte, non notifiée'
        using errcode = 'check_violation';
    end if;
    new.opened_at := now();
    new.updated_at := now();
    return new;
  end if;
  -- UPDATE
  if (new.id, new.kind, new.equipment_id, new.sensor_id, new.related_record_id, new.message, new.opened_at)
     is distinct from (old.id, old.kind, old.equipment_id, old.sensor_id, old.related_record_id, old.message, old.opened_at) then
    raise exception 'HACCP: alert_immutable — seules resolved_at, acknowledged_at et last_notified_at peuvent changer'
      using errcode = 'insufficient_privilege';
  end if;
  if old.resolved_at is not null and new.resolved_at is distinct from old.resolved_at then
    raise exception 'HACCP: alert_immutable — une alerte résolue le reste' using errcode = 'insufficient_privilege';
  end if;
  if old.acknowledged_at is not null and (new.acknowledged_at is distinct from old.acknowledged_at
                                          or new.acknowledged_by_record_id is distinct from old.acknowledged_by_record_id) then
    raise exception 'HACCP: alert_immutable — prise en compte définitive' using errcode = 'insufficient_privilege';
  end if;
  if old.acknowledged_at is null and new.acknowledged_at is null and new.acknowledged_by_record_id is not null then
    raise exception 'HACCP: alert_immutable — acknowledged_by_record_id sans acknowledged_at' using errcode = 'check_violation';
  end if;
  if old.last_notified_at is not null and new.last_notified_at is null then
    raise exception 'HACCP: alert_immutable — last_notified_at ne peut pas être effacé' using errcode = 'insufficient_privilege';
  end if;
  -- Horodatages imposés par le serveur.
  if old.resolved_at is null and new.resolved_at is not null then new.resolved_at := now(); end if;
  if old.acknowledged_at is null and new.acknowledged_at is not null then new.acknowledged_at := now(); end if;
  if new.last_notified_at is distinct from old.last_notified_at then new.last_notified_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists alerts_guard on public.alerts;
create trigger alerts_guard before insert or update or delete on public.alerts
  for each row execute function public.haccp_alerts_guard();
drop trigger if exists alerts_no_truncate on public.alerts;
create trigger alerts_no_truncate before truncate on public.alerts
  for each statement execute function public.haccp_alerts_guard();

revoke all on public.alerts from public, anon, authenticated, service_role;
grant select on public.alerts to authenticated, service_role;
grant insert (kind, equipment_id, sensor_id, related_record_id, message) on public.alerts to service_role;
grant update (resolved_at, last_notified_at) on public.alerts to service_role;
alter table public.alerts enable row level security;
drop policy if exists manager_read on public.alerts;
create policy manager_read on public.alerts for select to authenticated using (public.is_manager());

-- Prise en compte : à l'insertion d'un record `alert_ack` hors quarantaine (même transaction
-- que l'insertion dans le registre : impossible de perdre la prise en compte). sync-push a déjà
-- vérifié que l'alerte existe (sinon quarantaine). Une correction d'alert_ack n'a pas d'effet.
create or replace function public.haccp_records_alert_ack()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_alert text := new.payload ->> 'alert_id';
begin
  if new.quarantine_reason is null and new.type = 'alert_ack'
     and v_alert ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    update public.alerts
       set acknowledged_at = now(), acknowledged_by_record_id = new.id
     where id = v_alert::uuid and acknowledged_at is null;
  end if;
  return null;
end;
$$;
drop trigger if exists records_alert_ack on public.records;
create trigger records_alert_ack after insert on public.records
  for each row when (new.type = 'alert_ack') execute function public.haccp_records_alert_ack();

-- ---------------------------------------------------------------------------
-- 4. Abonnements Web Push (un par navigateur / appareil enrôlé)
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  device_id        uuid not null references public.devices (id) on delete restrict,
  endpoint         text not null unique,
  p256dh           text not null,
  auth             text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_success_at  timestamptz null,
  failures         integer not null default 0,
  constraint push_subscriptions_endpoint_check check (endpoint ~ '^https://[^[:space:]]+$' and char_length(endpoint) <= 2048),
  -- Clé P-256 non compressée (65 octets) et secret d'authentification (16 octets), base64url sans remplissage.
  constraint push_subscriptions_p256dh_check   check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  constraint push_subscriptions_auth_check     check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  constraint push_subscriptions_failures_check check (failures >= 0)
);
create index if not exists push_subscriptions_device_idx on public.push_subscriptions (device_id);
drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;
create trigger push_subscriptions_updated_at before insert or update on public.push_subscriptions
  for each row execute function public.haccp_set_updated_at();

-- Pas une donnée HACCP : l'Edge Function (service_role) crée, met à jour et supprime
-- (désabonnement, abonnement expiré 404/410). Le gérant voit seulement l'état (sans clés ni URL).
revoke all on public.push_subscriptions from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.push_subscriptions to service_role;
grant select (id, device_id, created_at, updated_at, last_success_at, failures) on public.push_subscriptions to authenticated;
alter table public.push_subscriptions enable row level security;
drop policy if exists manager_read on public.push_subscriptions;
create policy manager_read on public.push_subscriptions for select to authenticated using (public.is_manager());
