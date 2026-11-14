-- =============================================================================
-- HACCP Food Truck — purge de fin de conservation (seule suppression autorisée)
--
-- Règles :
--  * expiré = server_time < now() - settings.retention_years ;
--  * un enregistrement expiré est CONSERVÉ tant qu'un enregistrement conservé
--    le référence (directement ou transitivement) via supersedes_id :
--    une correction encore en conservation garde l'original qu'elle remplace ;
--  * le dernier maillon purgé de chaque appareil est mémorisé dans
--    record_chain_anchors pour que la chaîne reste prolongeable/vérifiable ;
--  * un résumé est écrit dans audit_log (action = 'PURGE').
-- =============================================================================

create function public.purge_expired_records()
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_years    integer;
  v_cutoff   timestamptz;
  v_count    bigint;
  v_by_type  jsonb;
  v_oldest   timestamptz;
  v_newest   timestamptz;
  v_kept_old bigint;
begin
  select s.retention_years into v_years from public.settings s where s.id = 1;
  if v_years is null then
    raise exception 'HACCP: purge impossible, paramètres (settings id = 1) absents';
  end if;
  v_cutoff := now() - make_interval(years => v_years);

  -- Une seule purge à la fois.
  perform pg_advisory_xact_lock(hashtextextended('haccp-purge', 0));

  -- Indicateur local à la transaction, reconnu par les triggers append-only
  -- uniquement lorsque current_user est le propriétaire des tables.
  perform set_config('haccp.purge_in_progress', 'on', true);

  create temporary table _haccp_purge (
    id uuid primary key, type text, device_id uuid, device_seq bigint, hash text, server_time timestamptz
  ) on commit drop;

  with recursive kept (id, supersedes_id) as (
    select r.id, r.supersedes_id from public.records r where r.server_time >= v_cutoff
    union
    select r.id, r.supersedes_id from public.records r join kept k on r.id = k.supersedes_id
  )
  insert into _haccp_purge
  select r.id, r.type, r.device_id, r.device_seq, r.hash, r.server_time
    from public.records r
   where r.server_time < v_cutoff
     and not exists (select 1 from kept k where k.id = r.id);

  select count(*), min(p.server_time), max(p.server_time),
         coalesce((select jsonb_object_agg(t.type, t.n)
                     from (select p2.type, count(*) as n from _haccp_purge p2 group by p2.type) t), '{}'::jsonb)
    into v_count, v_oldest, v_newest, v_by_type
    from _haccp_purge p;

  select count(*) into v_kept_old
    from public.records r
   where r.server_time < v_cutoff and not exists (select 1 from _haccp_purge p where p.id = r.id);

  if v_count > 0 then
    -- Ancre : maillon purgé le plus récent par appareil (n'avance que vers l'avant).
    insert into public.record_chain_anchors as a (device_id, device_seq, hash, purged_at)
    select distinct on (p.device_id) p.device_id, p.device_seq, p.hash, now()
      from _haccp_purge p
     order by p.device_id, p.device_seq desc
    on conflict (device_id) do update
      set device_seq = excluded.device_seq, hash = excluded.hash, purged_at = excluded.purged_at
      where excluded.device_seq > a.device_seq;

    delete from public.records r using _haccp_purge p where r.id = p.id;
  end if;

  perform set_config('haccp.purge_in_progress', 'off', true);

  insert into public.audit_log (actor, table_name, row_id, action, old, new)
  values (
    'system:purge', 'records', null, 'PURGE', null,
    jsonb_build_object(
      'deleted', v_count,
      'retention_years', v_years,
      'cutoff', v_cutoff,
      'oldest_server_time', v_oldest,
      'newest_server_time', v_newest,
      'by_type', v_by_type,
      'kept_expired_referenced', v_kept_old
    )
  );

  return v_count;
end;
$$;

comment on function public.purge_expired_records() is
  'Supprime les enregistrements dont la durée de conservation est dépassée (cohérent avec supersedes_id) et journalise un résumé.';

revoke all on function public.purge_expired_records() from public, anon, authenticated;
grant execute on function public.purge_expired_records() to service_role;
