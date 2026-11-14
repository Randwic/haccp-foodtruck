-- =============================================================================
-- HACCP Food Truck — intégrité : immutabilité du registre, chaîne de hachage,
-- updated_at, audit, protection des références, fonctions utilitaires.
-- Tous les messages d'erreur métier commencent par « HACCP: ».
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Indicateur de purge : posé (SET LOCAL) uniquement par purge_expired_records().
-- Il n'est reconnu que si l'utilisateur courant est le propriétaire de la table
-- (cas de la fonction SECURITY DEFINER) : un rôle applicatif qui poserait
-- lui-même l'indicateur reste bloqué.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Garde append-only (records, audit_log, record_chain_anchors)
-- record_chain_anchors : écriture réservée à la purge.
-- ---------------------------------------------------------------------------
create function public.haccp_append_only_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_years integer;
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'HACCP: TRUNCATE interdit sur %.% (registre en insertion seule)', tg_table_schema, tg_table_name
      using errcode = 'insufficient_privilege';
  end if;

  -- (vérification en ligne : la fonction trigger s'exécute avec les droits de l'appelant)
  if coalesce(current_setting('haccp.purge_in_progress', true), '') = 'on'
     and current_user = (select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = tg_relid) then
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

  raise exception 'HACCP: % interdit sur %.% (registre en insertion seule)', tg_op, tg_table_schema, tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger records_no_update   before update   on public.records              for each row       execute function public.haccp_append_only_guard();
create trigger records_no_delete   before delete   on public.records              for each row       execute function public.haccp_append_only_guard();
create trigger records_no_truncate before truncate on public.records              for each statement execute function public.haccp_append_only_guard();
create trigger audit_no_update     before update   on public.audit_log            for each row       execute function public.haccp_append_only_guard();
create trigger audit_no_delete     before delete   on public.audit_log            for each row       execute function public.haccp_append_only_guard();
create trigger audit_no_truncate   before truncate on public.audit_log            for each statement execute function public.haccp_append_only_guard();
create trigger anchors_no_insert   before insert   on public.record_chain_anchors for each row       execute function public.haccp_append_only_guard();
create trigger anchors_no_update   before update   on public.record_chain_anchors for each row       execute function public.haccp_append_only_guard();
create trigger anchors_no_delete   before delete   on public.record_chain_anchors for each row       execute function public.haccp_append_only_guard();
create trigger anchors_no_truncate before truncate on public.record_chain_anchors for each statement execute function public.haccp_append_only_guard();

-- ---------------------------------------------------------------------------
-- Contrôles à l'insertion dans records (filet de sécurité sous les Edge Functions)
--  * server_time imposé par le serveur (jamais par le client)
--  * clock_suspect calculé (OU logique avec la valeur fournie)
--  * appareil non révoqué
--  * chaîne de hachage : prev_hash = hash du maillon device_seq - 1
--    (ou de l'ancre de purge), pas de trou, genèse = GENESIS_HASH
-- ---------------------------------------------------------------------------
create function public.haccp_records_before_insert()
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

  select s.clock_suspect_minutes into v_clock_min from public.settings s where s.id = 1;
  new.clock_suspect := coalesce(new.clock_suspect, false)
    or abs(extract(epoch from (new.server_time - new.device_time))) > coalesce(v_clock_min, 5) * 60;

  select d.revoked_at into v_revoked from public.devices d where d.id = new.device_id;
  if v_revoked is not null then
    raise exception 'HACCP: device_revoked — appareil % révoqué', new.device_id
      using errcode = 'check_violation';
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
  else
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
  end if;

  if new.prev_hash is distinct from v_prev_hash then
    raise exception 'HACCP: broken_chain — prev_hash ne correspond pas au maillon % de l''appareil %', new.device_seq - 1, new.device_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger records_before_insert
  before insert on public.records
  for each row execute function public.haccp_records_before_insert();

-- ---------------------------------------------------------------------------
-- updated_at maintenu par le serveur
-- ---------------------------------------------------------------------------
create function public.haccp_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger staff_updated_at      before insert or update on public.staff      for each row execute function public.haccp_set_updated_at();
create trigger equipment_updated_at  before insert or update on public.equipment  for each row execute function public.haccp_set_updated_at();
create trigger thresholds_updated_at before insert or update on public.thresholds for each row execute function public.haccp_set_updated_at();
create trigger settings_updated_at   before insert or update on public.settings   for each row execute function public.haccp_set_updated_at();

-- ---------------------------------------------------------------------------
-- Appareils : champs d'enrôlement immuables, révocation définitive
-- ---------------------------------------------------------------------------
create function public.haccp_devices_guard()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
     or new.token_hash is distinct from old.token_hash
     or new.enrolled_at is distinct from old.enrolled_at
     or (new.enrolled_by is distinct from old.enrolled_by and new.enrolled_by is not null) then
    raise exception 'HACCP: champs d''enrôlement de l''appareil immuables'
      using errcode = 'insufficient_privilege';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'HACCP: révocation d''appareil définitive (réenrôler un nouvel appareil)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger devices_guard before update on public.devices
  for each row execute function public.haccp_devices_guard();

-- ---------------------------------------------------------------------------
-- Pas de suppression physique d'un membre / équipement référencé
-- (désactiver avec active = false)
-- ---------------------------------------------------------------------------
create function public.haccp_prevent_referenced_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_table_name = 'staff' then
    if exists (select 1 from public.records r where r.author_id = old.id) then
      raise exception 'HACCP: suppression interdite, membre % référencé par le registre (utiliser active = false)', old.id
        using errcode = 'foreign_key_violation';
    end if;
  elsif tg_table_name = 'equipment' then
    if exists (select 1 from public.records r where r.payload ->> 'equipment_id' = old.id::text)
       or exists (select 1 from public.thresholds t where t.equipment_id = old.id) then
      raise exception 'HACCP: suppression interdite, équipement % référencé (utiliser active = false)', old.id
        using errcode = 'foreign_key_violation';
    end if;
  end if;
  return old;
end;
$$;

create trigger staff_no_referenced_delete     before delete on public.staff     for each row execute function public.haccp_prevent_referenced_delete();
create trigger equipment_no_referenced_delete before delete on public.equipment for each row execute function public.haccp_prevent_referenced_delete();

-- ---------------------------------------------------------------------------
-- Audit des tables de référence (secrets masqués)
-- ---------------------------------------------------------------------------
create function public.haccp_mask_secrets(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_row is null then null else
    p_row
      || case when p_row ? 'pin_hash'   and p_row ->> 'pin_hash'   is not null then '{"pin_hash":"***"}'::jsonb   else '{}'::jsonb end
      || case when p_row ? 'pin_salt'   and p_row ->> 'pin_salt'   is not null then '{"pin_salt":"***"}'::jsonb   else '{}'::jsonb end
      || case when p_row ? 'token_hash' and p_row ->> 'token_hash' is not null then '{"token_hash":"***"}'::jsonb else '{}'::jsonb end
  end;
$$;

create function public.haccp_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_changed text[];
  v_row_id  text;
  v_actor   text;
begin
  -- Le passage de synchronisation (last_seen_at seul) n'est pas journalisé.
  if tg_op = 'UPDATE' and tg_table_name = 'devices'
     and (v_old - 'last_seen_at') = (v_new - 'last_seen_at') then
    return null;
  end if;
  if tg_op = 'UPDATE' and v_old = v_new then
    return null;
  end if;

  -- Indique quels secrets ont changé, sans jamais les écrire.
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
      from unnest(array['pin_hash', 'pin_salt', 'token_hash']) k
     where v_old ? k and (v_old -> k) is distinct from (v_new -> k);
  end if;

  v_row_id := coalesce(v_new, v_old) ->> case when tg_table_name = 'managers' then 'user_id' else 'id' end;
  v_actor  := coalesce(auth.uid()::text, 'service');

  v_new := public.haccp_mask_secrets(v_new);
  if v_changed is not null then
    v_new := v_new || jsonb_build_object('_secrets_changed', to_jsonb(v_changed));
  end if;

  insert into public.audit_log (actor, table_name, row_id, action, old, new)
  values (v_actor, tg_table_name, v_row_id, tg_op, public.haccp_mask_secrets(v_old), v_new);
  return null;
end;
$$;

create trigger establishment_audit after insert or update or delete on public.establishment for each row execute function public.haccp_audit();
create trigger managers_audit      after insert or update or delete on public.managers      for each row execute function public.haccp_audit();
create trigger staff_audit         after insert or update or delete on public.staff         for each row execute function public.haccp_audit();
create trigger devices_audit       after insert or update or delete on public.devices       for each row execute function public.haccp_audit();
create trigger equipment_audit     after insert or update or delete on public.equipment     for each row execute function public.haccp_audit();
create trigger thresholds_audit    after insert or update or delete on public.thresholds    for each row execute function public.haccp_audit();
create trigger settings_audit      after insert or update or delete on public.settings      for each row execute function public.haccp_audit();

-- ---------------------------------------------------------------------------
-- is_manager() : l'utilisateur connecté est-il gérant ?
-- ---------------------------------------------------------------------------
create function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select auth.uid() is not null
     and exists (select 1 from public.managers m where m.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- device_chain_head() : dernier maillon connu de la chaîne d'un appareil.
-- Si tous ses enregistrements ont été purgés, renvoie l'ancre de purge
-- (la chaîne continue à partir de là). Vide si l'appareil n'a jamais rien envoyé.
-- ---------------------------------------------------------------------------
create function public.device_chain_head(p_device_id uuid)
returns table (device_seq bigint, hash text)
language sql
stable
set search_path = public, pg_catalog
as $$
  select h.device_seq, h.hash
    from (
      (select r.device_seq, r.hash from public.records r
        where r.device_id = p_device_id order by r.device_seq desc limit 1)
      union all
      (select a.device_seq, a.hash from public.record_chain_anchors a
        where a.device_id = p_device_id)
    ) h
   order by h.device_seq desc
   limit 1;
$$;
