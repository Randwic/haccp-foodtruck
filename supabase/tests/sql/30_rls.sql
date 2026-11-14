-- RLS et privilèges : anon, utilisateur non gérant, gérant, service_role.

-- RLS activé partout dans public
select tests.assert(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  'RLS activé sur toutes les tables de public');

do $$
declare
  t text;
  v bigint;
begin
  foreach t in array array['establishment', 'managers', 'staff', 'devices', 'equipment', 'thresholds',
                           'settings', 'records', 'record_chain_anchors', 'audit_log'] loop
    -- anon : aucun accès
    perform tests.throws('anon ne lit pas ' || t, 'anon', null, format('select count(*) from public.%I', t), '%permission denied%');
    -- utilisateur authentifié non gérant : ne voit rien
    v := tests.value_as('authenticated', tests.user_uid(), format('select count(*) from public.%I', t))::bigint;
    perform tests.assert_eq(v, 0::bigint, 'non-gérant ne voit rien dans ' || t);
    -- authentifié sans JWT (sub absent) : rien non plus
    v := tests.value_as('authenticated', null, format('select count(*) from public.%I', t))::bigint;
    perform tests.assert_eq(v, 0::bigint, 'authentifié sans sub ne voit rien dans ' || t);
  end loop;

  -- gérant : lit tout
  foreach t in array array['establishment', 'managers', 'staff', 'devices', 'equipment', 'thresholds',
                           'settings', 'records', 'audit_log'] loop
    v := tests.value_as('authenticated', tests.manager_uid(), format('select count(*) from public.%I', t))::bigint;
    perform tests.assert(v > 0, format('gérant lit %s (%s lignes)', t, v));
  end loop;
end $$;

-- anon : aucune écriture, aucune fonction
select tests.throws('anon n''insère pas de record', 'anon', null,
  'insert into public.records (type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash) values (''system_test'', ''{}'', gen_random_uuid(), gen_random_uuid(), 1, now(), repeat(''0'',64), repeat(''0'',64))',
  '%permission denied%');
select tests.throws('anon ne modifie pas staff', 'anon', null, 'update public.staff set active = false', '%permission denied%');
select tests.throws('anon : is_manager() interdit', 'anon', null, 'select public.is_manager()', '%permission denied%');
select tests.throws('anon : device_chain_head() interdit', 'anon', null,
  format('select * from public.device_chain_head(%L)', tests.device1()), '%permission denied%');
select tests.throws('anon : purge interdite', 'anon', null, 'select public.purge_expired_records()', '%permission denied%');

-- is_manager()
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select public.is_manager()'), 'true', 'is_manager() vrai pour le gérant');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(),    'select public.is_manager()'), 'false', 'is_manager() faux pour un non-gérant');

-- Gérant : jamais d'insertion directe dans records
select tests.throws('gérant n''insère pas dans records', 'authenticated', tests.manager_uid(),
  format('insert into public.records (type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash) values (''system_test'', ''{}'', %L, %L, 3, now(), %L, repeat(''0'',64))',
    tests.staff1(), tests.device1(), (select hash from public.device_chain_head(tests.device1()))),
  '%permission denied%');
select tests.throws('gérant ne s''ajoute pas de gérant', 'authenticated', tests.manager_uid(),
  format('insert into public.managers (user_id) values (%L)', tests.user_uid()), '%permission denied%');
select tests.throws('non-gérant ne s''auto-promeut pas', 'authenticated', tests.user_uid(),
  format('insert into public.managers (user_id) values (%L)', tests.user_uid()), '%permission denied%');
select tests.throws('gérant : purge interdite', 'authenticated', tests.manager_uid(), 'select public.purge_expired_records()', '%permission denied%');

-- Gérant : écrit les références
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.equipment set name = ''Frigo A'' where name = ''Frigo 1'' returning 1) select count(*) from u'), '1',
  'gérant modifie un équipement');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.equipment (name, kind) values (''Bain-marie'', ''hot_holding'') returning 1) select count(*) from u'), '1',
  'gérant ajoute un équipement');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  format('with u as (insert into public.staff (display_name, pin_salt, pin_hash) values (''Bob'', %L, %L) returning 1) select count(*) from u',
    tests.b64('s', 16), tests.b64('h', 32))), '1', 'gérant ajoute un membre');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.settings set auto_lock_minutes = 3 returning 1) select count(*) from u'), '1', 'gérant modifie les paramètres');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.thresholds set max_c = 3 where max_c = 4 returning 1) select count(*) from u'), '2', 'gérant modifie les seuils');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.establishment set name = ''Le Camion'' returning 1) select count(*) from u'), '1', 'gérant renomme l''établissement');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  format('with u as (update public.devices set revoked_at = now() where id = %L returning 1) select count(*) from u', tests.device2())), '1',
  'gérant révoque un appareil');
select tests.throws('gérant ne modifie pas token_hash', 'authenticated', tests.manager_uid(),
  'update public.devices set token_hash = repeat(''f'', 64)', '%permission denied%');
select tests.throws('gérant n''enrôle pas directement', 'authenticated', tests.manager_uid(),
  format('insert into public.devices (name, token_hash) values (''x'', %L)', repeat('f', 64)), '%permission denied%');
select tests.throws('gérant ne supprime pas de membre', 'authenticated', tests.manager_uid(), 'delete from public.staff', '%permission denied%');
select tests.throws('gérant ne supprime pas d''équipement', 'authenticated', tests.manager_uid(), 'delete from public.equipment', '%permission denied%');
select tests.throws('gérant ne supprime pas de seuil', 'authenticated', tests.manager_uid(), 'delete from public.thresholds', '%permission denied%');

-- Non-gérant : aucune écriture
select tests.throws('non-gérant n''ajoute pas de membre', 'authenticated', tests.user_uid(),
  format('insert into public.staff (display_name, pin_salt, pin_hash) values (''Eve'', %L, %L)', tests.b64('s', 16), tests.b64('h', 32)),
  '%row-level security%');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(),
  'with u as (update public.staff set active = false returning 1) select count(*) from u'), '0', 'non-gérant ne désactive personne');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(),
  'with u as (update public.settings set retention_years = 1 returning 1) select count(*) from u'), '0', 'non-gérant ne change pas la conservation');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(),
  'with u as (update public.devices set revoked_at = now() returning 1) select count(*) from u'), '0', 'non-gérant ne révoque rien');

-- service_role (Edge Functions) : insère dans records, lit, mais ne modifie/supprime pas
select tests.assert_eq(tests.value_as('service_role', null,
  format('with u as (insert into public.records (type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash) values (''system_test'', ''{}'', %L, %L, 3, now(), %L, repeat(''3'',64)) returning 1) select count(*) from u',
    tests.staff1(), tests.device1(), (select hash from public.device_chain_head(tests.device1())))), '1',
  'service_role insère dans records');
select tests.assert_eq(tests.value_as('service_role', null, format('select device_seq from public.device_chain_head(%L)', tests.device1())), '2',
  'service_role appelle device_chain_head()');
select tests.assert_eq(tests.value_as('service_role', null,
  format('with u as (update public.devices set last_seen_at = now() where id = %L returning 1) select count(*) from u', tests.device1())), '1',
  'service_role met à jour last_seen_at');
select tests.throws('service_role ne supprime pas de membre', 'service_role', null, 'delete from public.staff', '%permission denied%');
select tests.throws('service_role ne modifie pas managers', 'service_role', null,
  format('insert into public.managers (user_id) values (%L)', tests.user_uid()), '%permission denied%');

-- Aucune fonction de public n'est exécutable par PUBLIC / anon
select tests.assert(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  'anon n''a EXECUTE sur aucune fonction de public');
