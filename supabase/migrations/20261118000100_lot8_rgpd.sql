-- =============================================================================
-- HACCP Food Truck — lot 8 : RGPD (données personnelles de l'équipe)
--  1. staff : deactivated_at (date de départ, tenue par trigger), privacy_notice_on
--     (date de remise de la note d'information), forgotten_at (données effacées).
--  2. Garde : un membre effacé ne peut plus être réactivé ni renommé ; forgotten_at
--     n'est posé que par haccp_staff_forget().
--  3. haccp_staff_forget(id, motif) : remplace le nom par « Ancien équipier n° N »,
--     rend le PIN inutilisable et retire le nom des anciennes lignes du journal
--     d'audit (seule modification permise de audit_log, colonne display_name
--     uniquement). Les saisies HACCP restent (obligation légale), sous le pseudonyme.
--  4. staff_forget(id) : appel par le gérant (ex-salarié désactivé, jamais un gérant).
--  5. forget_former_staff() : effacement automatique, chaque nuit, des anciens
--     salariés désactivés depuis plus de 30 jours et dont plus aucune saisie n'est
--     conservée (durée de conservation du registre écoulée). pg_cron 03:37 UTC.
--  Migration idempotente (rejouable).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colonnes
-- ---------------------------------------------------------------------------
alter table public.staff add column if not exists deactivated_at    timestamptz null;
alter table public.staff add column if not exists privacy_notice_on date null;
alter table public.staff add column if not exists forgotten_at      timestamptz null;

comment on column public.staff.deactivated_at is
  'Date de désactivation (départ). Tenue par le trigger staff_rgpd_guard. Point de départ de l''effacement automatique.';
comment on column public.staff.privacy_notice_on is
  'RGPD : date à laquelle la note d''information sur les données a été remise à la personne (art. 13).';
comment on column public.staff.forgotten_at is
  'RGPD : données personnelles effacées (nom remplacé par un pseudonyme, PIN inutilisable). Définitif.';

-- Membres déjà désactivés avant ce lot : date de départ = dernière modification.
update public.staff set deactivated_at = updated_at where not active and deactivated_at is null;

-- ---------------------------------------------------------------------------
-- 2. Garde des colonnes RGPD
-- ---------------------------------------------------------------------------
create or replace function public.haccp_staff_rgpd_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_forget boolean := coalesce(current_setting('haccp.staff_forget', true), '') = new.id::text
                      and current_user = (select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = tg_relid);
begin
  if new.privacy_notice_on is not null and new.privacy_notice_on > current_date + 1 then
    raise exception 'HACCP: privacy_notice_future — date de remise de la note d''information dans le futur'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.forgotten_at is not null then
      raise exception 'HACCP: staff_forgotten — un membre ne peut pas être créé effacé'
        using errcode = 'insufficient_privilege';
    end if;
    new.deactivated_at := case when new.active then null else coalesce(new.deactivated_at, now()) end;
    return new;
  end if;

  if old.forgotten_at is not null then
    if new.forgotten_at is distinct from old.forgotten_at or new.active
       or new.display_name is distinct from old.display_name
       or new.pin_hash is distinct from old.pin_hash or new.pin_salt is distinct from old.pin_salt
       or new.role is distinct from old.role then
      raise exception 'HACCP: staff_forgotten — données de ce membre effacées (RGPD), fiche figée'
        using errcode = 'insufficient_privilege';
    end if;
  elsif new.forgotten_at is not null and not v_forget then
    raise exception 'HACCP: staff_forget_direct — effacement réservé à staff_forget()'
      using errcode = 'insufficient_privilege';
  end if;

  if new.active and not old.active then
    new.deactivated_at := null;
  elsif not new.active and old.active then
    new.deactivated_at := now();
  elsif not new.active and new.deactivated_at is null then
    new.deactivated_at := coalesce(old.deactivated_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists staff_rgpd_guard on public.staff;
create trigger staff_rgpd_guard before insert or update on public.staff
  for each row execute function public.haccp_staff_rgpd_guard();

-- ---------------------------------------------------------------------------
-- 3. Garde append-only : seule exception ajoutée = retrait du nom d'un membre
--    effacé dans audit_log (même transaction que haccp_staff_forget, propriétaire).
--    Le reste de la fonction est identique à la migration d'intégrité.
-- ---------------------------------------------------------------------------
create or replace function public.haccp_append_only_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_years integer;
  v_owner boolean;
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'HACCP: TRUNCATE interdit sur %.% (registre en insertion seule)', tg_table_schema, tg_table_name
      using errcode = 'insufficient_privilege';
  end if;

  -- (vérification en ligne : la fonction trigger s'exécute avec les droits de l'appelant)
  v_owner := current_user = (select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = tg_relid);

  if coalesce(current_setting('haccp.purge_in_progress', true), '') = 'on' and v_owner then
    -- Purge : seuls les enregistrements expirés de records peuvent être supprimés.
    if tg_table_name = 'records' and tg_op = 'DELETE' then
      select s.retention_years into v_years from public.settings s where s.id = 1;
      if v_years is not null and old.server_time < now() - make_interval(years => v_years) then
        return old;
      end if;
      raise exception 'HACCP: purge refusée, enregistrement % non expiré', old.id
        using errcode = 'insufficient_privilege';
    end if;
    -- Purge : création d'une ancre de chaîne.
    if tg_table_name = 'record_chain_anchors' and tg_op = 'INSERT' then
      return new;
    end if;
    -- Purge : l'ancre de chaîne ne peut qu'avancer.
    if tg_table_name = 'record_chain_anchors' and tg_op = 'UPDATE' then
      if new.device_id = old.device_id and new.device_seq > old.device_seq then
        return new;
      end if;
    end if;
  end if;

  -- RGPD : nom d'un membre effacé retiré de ses lignes d'audit (display_name seulement).
  if tg_table_name = 'audit_log' and tg_op = 'UPDATE' and v_owner
     and old.table_name = 'staff'
     and coalesce(current_setting('haccp.staff_forget', true), '') = old.row_id
     and new.id = old.id and new.at = old.at and new.actor = old.actor and new.table_name = old.table_name
     and new.row_id = old.row_id and new.action = old.action
     and (new.old is null) = (old.old is null) and (new.new is null) = (old.new is null)
     and (new.old is null or (new.old - 'display_name') = (old.old - 'display_name'))
     and (new.new is null or (new.new - 'display_name') = (old.new - 'display_name')) then
    return new;
  end if;

  raise exception 'HACCP: % interdit sur %.% (registre en insertion seule)', tg_op, tg_table_schema, tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Effacement (pseudonymisation) d'un membre
-- ---------------------------------------------------------------------------
create or replace function public.haccp_staff_forget(p_staff_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_staff   public.staff%rowtype;
  v_number  integer;
  v_pseudo  text;
  v_records bigint;
begin
  if p_reason not in ('manager', 'auto') then
    raise exception 'HACCP: motif d''effacement inconnu %', p_reason;
  end if;
  -- Numérotation des pseudonymes : un effacement à la fois.
  perform pg_advisory_xact_lock(hashtextextended('haccp-staff-forget', 0));

  select * into v_staff from public.staff where id = p_staff_id for update;
  if not found then
    raise exception 'HACCP: staff_not_found — membre % inconnu', p_staff_id using errcode = 'no_data_found';
  end if;
  if v_staff.forgotten_at is not null then
    return jsonb_build_object('staff_id', v_staff.id, 'display_name', v_staff.display_name, 'already', true);
  end if;
  if v_staff.role = 'manager' then
    raise exception 'HACCP: staff_forget_manager — le compte d''un gérant ne peut pas être effacé ici'
      using errcode = 'insufficient_privilege';
  end if;
  if v_staff.active then
    raise exception 'HACCP: staff_forget_active — désactiver le compte avant d''effacer ses données'
      using errcode = 'check_violation';
  end if;

  select count(*) + 1 into v_number from public.staff where forgotten_at is not null;
  v_pseudo := 'Ancien équipier n° ' || v_number;
  select count(*) into v_records from public.records where author_id = p_staff_id;

  perform set_config('haccp.staff_forget', p_staff_id::text, true);

  update public.staff
     set display_name = v_pseudo,
         -- PIN inutilisable : sel et empreinte aléatoires (aucun code ne correspond).
         pin_salt     = encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'),
         pin_hash     = encode(decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'),
         privacy_notice_on = null,
         forgotten_at = now()
   where id = p_staff_id;

  -- Le nom disparaît aussi du journal d'audit (y compris la ligne écrite par l'UPDATE ci-dessus).
  update public.audit_log a
     set old = case when a.old ? 'display_name' then a.old || jsonb_build_object('display_name', v_pseudo) else a.old end,
         new = case when a.new ? 'display_name' then a.new || jsonb_build_object('display_name', v_pseudo) else a.new end
   where a.table_name = 'staff' and a.row_id = p_staff_id::text
     and (a.old ? 'display_name' or a.new ? 'display_name');

  perform set_config('haccp.staff_forget', '', true);

  insert into public.audit_log (actor, table_name, row_id, action, old, new)
  values (coalesce(auth.uid()::text, 'service'), 'staff', p_staff_id::text, 'RGPD_FORGET', null,
          jsonb_build_object('display_name', v_pseudo, 'reason', p_reason, 'records_kept', v_records));

  return jsonb_build_object('staff_id', p_staff_id, 'display_name', v_pseudo, 'records_kept', v_records, 'already', false);
end;
$$;
comment on function public.haccp_staff_forget(uuid, text) is
  'RGPD : efface les données personnelles d''un membre désactivé (pseudonyme, PIN inutilisable, nom retiré du journal). Interne.';
revoke all on function public.haccp_staff_forget(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.staff_forget(p_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.is_manager() then
    raise exception 'HACCP: réservé au gérant' using errcode = 'insufficient_privilege';
  end if;
  return public.haccp_staff_forget(p_staff_id, 'manager');
end;
$$;
comment on function public.staff_forget(uuid) is
  'RGPD : le gérant efface les données personnelles d''un ancien membre (désactivé, pas un gérant). Ses saisies restent sous un pseudonyme.';
revoke all on function public.staff_forget(uuid) from public, anon, authenticated, service_role;
grant execute on function public.staff_forget(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Effacement automatique en fin de conservation
-- ---------------------------------------------------------------------------
create or replace function public.forget_former_staff()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    select s.id from public.staff s
     where not s.active and s.forgotten_at is null and s.role = 'staff'
       and s.deactivated_at < now() - interval '30 days'
       and not exists (select 1 from public.records r where r.author_id = s.id)
     order by s.deactivated_at
  loop
    perform public.haccp_staff_forget(v_id, 'auto');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function public.forget_former_staff() is
  'RGPD : chaque nuit, efface les anciens équipiers désactivés depuis plus de 30 jours sans saisie conservée.';
revoke all on function public.forget_former_staff() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('haccp-forget-former-staff', '37 3 * * *', 'select public.forget_former_staff()');
    exception when others then
      raise warning 'HACCP: planification pg_cron impossible (%)', sqlerrm;
    end;
  else
    raise warning 'HACCP: extension pg_cron absente, effacement automatique non planifié';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Vue staff_public (export) : colonnes RGPD en plus
-- ---------------------------------------------------------------------------
create or replace view public.staff_public with (security_invoker = true) as
  select s.id, s.display_name, s.role, s.active, s.created_at, s.updated_at,
         s.deactivated_at, s.privacy_notice_on, s.forgotten_at
    from public.staff s;
