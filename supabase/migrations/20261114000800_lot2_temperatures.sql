-- =============================================================================
-- HACCP Food Truck — lot 2 (températures)
--  1. settings.daily_check_times : heures des relevés d'enceintes (HH:MM, 1 à 6)
--  2. Seuils génériques par défaut des procédés (equipment_id null), idempotents
--  3. Horloge suspecte sans faux positifs : records.device_now (horloge de
--     l'appareil au moment de l'ENVOI) remplace device_time dans le calcul
--  Les types du lot 2 (cooling, reheating, thawing, hot_holding, cooking_check)
--  figurent déjà dans haccp_known_record_type() (…0600) : rien à changer.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Heures des relevés quotidiens (heure locale de l'établissement)
-- ---------------------------------------------------------------------------
create function public.haccp_valid_check_times(p text[])
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select p is not null
     and array_ndims(p) = 1
     and cardinality(p) between 1 and 6
     and not exists (
       select 1 from unnest(p) t
        where t is null or t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     )
     and (select count(distinct t) from unnest(p) t) = cardinality(p);
$$;
revoke all on function public.haccp_valid_check_times(text[]) from public, anon;
-- EXECUTE requis par la contrainte CHECK pour les rôles qui écrivent settings.
grant execute on function public.haccp_valid_check_times(text[]) to authenticated, service_role;

alter table public.settings
  add column daily_check_times text[] not null default '{08:00,18:00}';
alter table public.settings
  add constraint settings_daily_check_times_check check (public.haccp_valid_check_times(daily_check_times));

comment on column public.settings.daily_check_times is
  'Heures des relevés d''enceintes (HH:MM, heure locale de l''établissement), 1 à 6 heures distinctes.';

-- ---------------------------------------------------------------------------
-- 2. Seuils génériques par défaut — À CONFIRMER SELON LE PMS.
--    Miroir de DEFAULT_PROCESS_THRESHOLDS (shared/payloads.ts). tolerance_minutes
--    = durée maximale du procédé (cooling 120 min, reheating 60 min).
--    Le « départ ≥ +63 °C » du refroidissement n'a pas de ligne propre (une seule
--    ligne par type) : il reste la valeur par défaut de l'app.
--    Idempotent : un seuil générique déjà saisi par le gérant n'est pas écrasé.
-- ---------------------------------------------------------------------------
insert into public.thresholds (id, equipment_id, check_type, min_c, max_c, tolerance_minutes) values
  ('00000000-0000-4000-8000-000000000211', null, 'hot_holding',   63,   null,   0), -- maintien au chaud ≥ +63 °C (à confirmer selon le PMS)
  ('00000000-0000-4000-8000-000000000212', null, 'cooking_check', 70,   null,   0), -- cuisson à cœur ≥ +70 °C (à confirmer selon le PMS)
  ('00000000-0000-4000-8000-000000000213', null, 'cooling',       null, 10,   120), -- refroidissement ≤ +10 °C en 120 min (à confirmer selon le PMS)
  ('00000000-0000-4000-8000-000000000214', null, 'reheating',     63,   null,  60)  -- remise en température ≥ +63 °C en 60 min (à confirmer selon le PMS)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Horloge suspecte
--
-- Ancienne règle (conservée en repli) : |server_time − device_time| > X min,
-- par enregistrement. Elle signalait à tort toute saisie faite hors réseau et
-- envoyée plus tard, même avec une horloge juste.
--
-- Nouvelle règle : l'app envoie device_now (son horloge au moment de l'envoi) ;
-- l'Edge Function le transmet dans records.device_now et le trigger calcule
-- |server_time − device_now| > X min. Tout le lot partage le même device_now,
-- et l'Edge Function, qui juge le lot une fois, fournit clock_suspect = true
-- pour tout le lot s'il est suspect.
--
-- Inviolabilité :
--  * clock_suspect reste un OU logique : une valeur fournie ne peut qu'ajouter
--    le signalement, jamais l'effacer ;
--  * device_now n'est pris en compte que pour le rôle service_role (Edge
--    Functions) ; pour tout autre rôle il est mis à null et l'ancienne règle
--    s'applique (de toute façon seul service_role a INSERT sur records).
--    Test fait sur current_setting('role') : dans une fonction SECURITY DEFINER,
--    current_user est le propriétaire, mais le paramètre role reste celui de
--    l'appelant (SET ROLE / PostgREST).
-- ---------------------------------------------------------------------------
alter table public.records add column device_now timestamptz null;
comment on column public.records.device_now is
  'Horloge de l''appareil au moment de l''envoi (SyncPushRequest.device_now), posée par l''Edge Function. Hors hash. Sert au calcul de clock_suspect ; null = ancienne app (calcul sur device_time).';

create or replace function public.haccp_records_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_revoked   timestamptz;
  v_prev_hash text;
  v_clock_min integer;
begin
  new.server_time := now();

  -- device_now n'est accepté que des Edge Functions.
  if coalesce(current_setting('role', true), 'none') <> 'service_role' then
    new.device_now := null;
  end if;

  select s.clock_suspect_minutes into v_clock_min from public.settings s where s.id = 1;
  new.clock_suspect := coalesce(new.clock_suspect, false)
    or abs(extract(epoch from (new.server_time - coalesce(new.device_now, new.device_time)))) > coalesce(v_clock_min, 5) * 60;

  select d.revoked_at into v_revoked from public.devices d where d.id = new.device_id;
  if v_revoked is not null then
    raise exception 'HACCP: device_revoked — appareil % révoqué', new.device_id
      using errcode = 'check_violation';
  end if;

  -- Contrôles de contenu (remplacent les clés étrangères) : hors quarantaine seulement.
  if new.quarantine_reason is null then
    if not exists (select 1 from public.staff s where s.id = new.author_id) then
      raise exception 'HACCP: unknown_author — membre % inconnu', new.author_id
        using errcode = 'foreign_key_violation';
    end if;
    if new.supersedes_id is not null
       and not exists (select 1 from public.records r where r.id = new.supersedes_id) then
      raise exception 'HACCP: supersedes_not_found — enregistrement corrigé % introuvable', new.supersedes_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  -- Valeurs hors format : laisser les contraintes CHECK produire l'erreur explicite.
  if new.device_seq is null or new.device_seq < 1
     or new.prev_hash is null or new.prev_hash !~ '^[0-9a-f]{64}$' then
    return new;
  end if;

  -- Sérialise les insertions d'un même appareil (chaîne linéaire).
  perform pg_advisory_xact_lock(hashtextextended('haccp-chain:' || new.device_id::text, 0));

  if new.device_seq = 1 then
    -- Genèse : la contrainte records_genesis impose prev_hash = GENESIS_HASH.
    return new;
  end if;

  select r.hash into v_prev_hash
    from public.records r
   where r.device_id = new.device_id and r.device_seq = new.device_seq - 1;
  if v_prev_hash is null then
    select a.hash into v_prev_hash
      from public.record_chain_anchors a
     where a.device_id = new.device_id and a.device_seq = new.device_seq - 1;
  end if;
  if v_prev_hash is null then
    raise exception 'HACCP: seq_gap — maillon % absent pour l''appareil %', new.device_seq - 1, new.device_id
      using errcode = 'check_violation';
  end if;

  if new.prev_hash is distinct from v_prev_hash then
    raise exception 'HACCP: broken_chain — prev_hash ne correspond pas au maillon % de l''appareil %', new.device_seq - 1, new.device_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
