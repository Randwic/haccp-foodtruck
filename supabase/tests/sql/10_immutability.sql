-- Registre infalsifiable : UPDATE / DELETE / TRUNCATE refusés sur records et audit_log,
-- pour chaque rôle, au niveau des privilèges ET au niveau des triggers.

-- Une ancre de chaîne pour que les triggers ligne de record_chain_anchors aient une cible
-- (écriture possible seulement par le propriétaire avec l'indicateur de purge).
select tests.throws('insert ancre sans indicateur refusé', 'postgres', null,
  format('insert into public.record_chain_anchors (device_id, device_seq, hash) values (%L, 7, repeat(''b'', 64))', tests.device2()),
  '%HACCP:%INSERT interdit%');
begin;
select set_config('haccp.purge_in_progress', 'on', true);
insert into public.record_chain_anchors (device_id, device_seq, hash) values (tests.device2(), 7, repeat('b', 64));
commit;

-- 1. Avec la configuration réelle (privilèges + RLS + triggers)
do $$
declare
  v_role  record;
  v_stmt  text;
begin
  for v_role in
    select * from (values
      ('anon',          null::uuid),
      ('authenticated', tests.user_uid()),
      ('authenticated', tests.manager_uid()),
      ('service_role',  null::uuid),
      ('postgres',      null::uuid)       -- propriétaire / superutilisateur : bloqué par les triggers
    ) as t(role, uid)
  loop
    foreach v_stmt in array array[
      'update public.records set payload = ''{"x":1}''',
      'delete from public.records',
      'truncate public.records',
      'truncate public.records cascade',
      'update public.audit_log set actor = ''pirate''',
      'delete from public.audit_log',
      'truncate public.audit_log',
      'update public.record_chain_anchors set hash = repeat(''a'', 64)',
      'delete from public.record_chain_anchors',
      'truncate public.record_chain_anchors'
    ] loop
      perform tests.throws(
        format('refus « %s » (%s)', v_stmt, coalesce(v_role.uid::text, '-')),
        v_role.role, v_role.uid, v_stmt,
        case when v_role.role = 'postgres' then '%HACCP:%' else '%' end);
    end loop;
  end loop;
end $$;

-- Rien n'a bougé
select tests.assert_eq((select count(*) from public.records), 2::bigint, 'records intacts après les tentatives');
select tests.assert((select count(*) from public.audit_log) > 0, 'audit_log intact après les tentatives');

-- 2. Défense en profondeur : même si quelqu'un accordait par erreur tous les privilèges
--    et une politique RLS permissive, les triggers bloquent encore.
begin;
grant all on public.records, public.audit_log to anon, authenticated, service_role;
create policy oops_all on public.records   for all using (true) with check (true);
create policy oops_all on public.audit_log for all using (true) with check (true);

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    perform tests.throws('trigger bloque UPDATE records',   v_role, tests.manager_uid(), 'update public.records set payload = ''{"x":1}''', '%HACCP:%UPDATE interdit%');
    perform tests.throws('trigger bloque DELETE records',   v_role, tests.manager_uid(), 'delete from public.records',                      '%HACCP:%DELETE interdit%');
    perform tests.throws('trigger bloque TRUNCATE records', v_role, tests.manager_uid(), 'truncate public.records',                         '%HACCP:%TRUNCATE interdit%');
    perform tests.throws('trigger bloque UPDATE audit_log', v_role, tests.manager_uid(), 'update public.audit_log set actor = ''x''',       '%HACCP:%UPDATE interdit%');
    perform tests.throws('trigger bloque DELETE audit_log', v_role, tests.manager_uid(), 'delete from public.audit_log',                    '%HACCP:%DELETE interdit%');
    perform tests.throws('trigger bloque TRUNCATE audit_log', v_role, tests.manager_uid(), 'truncate public.audit_log',                     '%HACCP:%TRUNCATE interdit%');
    -- Forger l'indicateur de purge ne suffit pas (current_user ≠ propriétaire)
    perform tests.throws('indicateur de purge forgé inopérant', v_role, tests.manager_uid(),
      'select set_config(''haccp.purge_in_progress'', ''on'', true); delete from public.records', '%HACCP:%DELETE interdit%');
  end loop;
end $$;
rollback;

-- 3. Même le propriétaire avec l'indicateur de purge ne peut ni modifier,
--    ni supprimer un enregistrement non expiré.
select tests.throws('propriétaire + indicateur : UPDATE refusé', 'postgres', null,
  'select set_config(''haccp.purge_in_progress'', ''on'', true); update public.records set payload = ''{"x":1}''', '%HACCP:%UPDATE interdit%');
select tests.throws('propriétaire + indicateur : DELETE non expiré refusé', 'postgres', null,
  'select set_config(''haccp.purge_in_progress'', ''on'', true); delete from public.records', '%HACCP: purge refusée%non expiré%');
select tests.throws('propriétaire + indicateur : audit_log toujours immuable', 'postgres', null,
  'select set_config(''haccp.purge_in_progress'', ''on'', true); delete from public.audit_log', '%HACCP:%DELETE interdit%');

-- 4. Insertion directe dans audit_log interdite aux rôles applicatifs
select tests.throws('insert audit_log refusé', r, tests.manager_uid(),
  'insert into public.audit_log (actor, table_name, action) values (''x'', ''x'', ''x'')', '%permission denied%')
  from unnest(array['anon', 'authenticated', 'service_role']) r;
