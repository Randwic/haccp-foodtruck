-- Paramétrage par le gérant via l'API REST (supabase-js, rôle authenticated + RLS) :
-- equipment, thresholds, staff (PIN compris), settings, establishment.
-- PostgREST : insert/update … returning (select), upsert = insert … on conflict do update.

-- equipment
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.equipment (name, kind) values (''Saladette'', ''fridge'') returning id, name) select name from u'),
  'Saladette', 'gérant : insert equipment … returning');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.equipment (id, name, kind) values (''00000000-0000-4000-8000-000000000101'', ''Frigo bis'', ''fridge'')
     on conflict (id) do update set name = excluded.name returning name) select name from u'),
  'Frigo bis', 'gérant : upsert equipment');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.equipment set active = false where name = ''Frigo 2'' returning 1) select count(*) from u'),
  '1', 'gérant : désactive un équipement');

-- thresholds
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.thresholds (equipment_id, check_type, min_c, max_c, tolerance_minutes)
     values (''00000000-0000-4000-8000-000000000104'', ''oil_check'', null, 180, 0) returning max_c) select max_c::text from u'),
  '180.0', 'gérant : insert threshold');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.thresholds (equipment_id, check_type, max_c)
     values (''00000000-0000-4000-8000-000000000101'', ''temperature_check'', 3)
     on conflict (equipment_id, check_type) do update set max_c = excluded.max_c returning max_c) select max_c::text from u'),
  '3.0', 'gérant : upsert threshold (clé equipment_id, check_type)');

-- staff (PIN compris)
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  format('with u as (update public.staff set pin_salt = %L, pin_hash = %L where id = %L returning pin_hash) select pin_hash from u',
    tests.b64('nouveau-sel', 16), tests.b64('nouveau-pin', 32), tests.staff1())),
  tests.b64('nouveau-pin', 32), 'gérant : change le PIN d''un équipier');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  format('with u as (update public.staff set display_name = ''Alice B.'', role = ''manager'', active = false where id = %L returning 1) select count(*) from u',
    tests.staff1())), '1', 'gérant : renomme / change le rôle / désactive un équipier');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  format('with u as (insert into public.staff (display_name, role, pin_salt, pin_hash) values (''Chloé'', ''staff'', %L, %L) returning display_name) select display_name from u',
    tests.b64('s-c', 16), tests.b64('h-c', 32))), 'Chloé', 'gérant : ajoute un équipier … returning');
select tests.throws('PIN invalide refusé même pour le gérant', 'authenticated', tests.manager_uid(),
  format('update public.staff set pin_hash = ''1234'' where id = %L', tests.staff1()), '%staff_pin_hash_check%');
-- Le changement de PIN est audité, secrets masqués.
select tests.exec_as('authenticated', tests.manager_uid(),
  format('update public.staff set pin_salt = %L, pin_hash = %L where id = %L', tests.b64('sel-2', 16), tests.b64('pin-2', 32), tests.staff1()));
select tests.assert(
  exists (select 1 from public.audit_log a
           where a.table_name = 'staff' and a.action = 'UPDATE' and a.row_id = tests.staff1()::text
             and a.actor = tests.manager_uid()::text and a.new ->> 'pin_hash' = '***'
             and a.new -> '_secrets_changed' = '["pin_hash", "pin_salt"]'::jsonb),
  'audit : changement de PIN journalisé (acteur = gérant, secrets masqués)');

-- settings (ligne unique) et establishment (ligne unique)
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.settings (id, retention_years, auto_lock_minutes) values (1, 3, 10)
     on conflict (id) do update set auto_lock_minutes = excluded.auto_lock_minutes returning auto_lock_minutes) select auto_lock_minutes::text from u'),
  '10', 'gérant : upsert settings');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.settings set email_alerts = false where id = 1 returning 1) select count(*) from u'), '1', 'gérant : modifie settings');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.establishment set name = ''Chez Paul'', timezone = ''Europe/Brussels'' returning name) select name from u'),
  'Chez Paul', 'gérant : modifie establishment');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.establishment (id, name) values (''00000000-0000-4000-8000-000000000001'', ''Camion 2'')
     on conflict (id) do update set name = excluded.name returning name) select name from u'),
  'Camion 2', 'gérant : upsert establishment');

-- Non-gérant connecté : rien
do $$
declare
  w text;
begin
  foreach w in array array[
    'insert into public.equipment (name, kind) values (''X'', ''fridge'')',
    'insert into public.thresholds (check_type, max_c) values (''cooling'', 10)',
    format('insert into public.staff (display_name, pin_salt, pin_hash) values (''X'', %L, %L)', tests.b64('s', 16), tests.b64('h', 32)),
    'insert into public.settings (id) values (1) on conflict (id) do update set retention_years = 1',
    'insert into public.establishment (id, name) values (''00000000-0000-4000-8000-000000000001'', ''X'') on conflict (id) do update set name = excluded.name'
  ] loop
    perform tests.throws('non-gérant : ' || left(w, 40), 'authenticated', tests.user_uid(), w, '%row-level security%');
  end loop;
  foreach w in array array[
    'update public.equipment set name = ''X''',
    'update public.thresholds set max_c = 50',
    format('update public.staff set pin_salt = %L, pin_hash = %L', tests.b64('s', 16), tests.b64('h', 32)),
    'update public.settings set retention_years = 1',
    'update public.establishment set name = ''X'''
  ] loop
    perform tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), format('with u as (%s returning 1) select count(*) from u', w)),
      '0', 'non-gérant : aucune ligne modifiée — ' || left(w, 40));
    perform tests.throws('anon : ' || left(w, 40), 'anon', null, w, '%permission denied%');
  end loop;
  perform tests.throws('anon : insert equipment', 'anon', null, 'insert into public.equipment (name, kind) values (''X'', ''fridge'')', '%permission denied%');
  perform tests.throws('anon : insert staff', 'anon', null,
    format('insert into public.staff (display_name, pin_salt, pin_hash) values (''X'', %L, %L)', tests.b64('s', 16), tests.b64('h', 32)), '%permission denied%');
end $$;

-- Rien n'a bougé du fait du non-gérant
select tests.assert_eq((select count(*) from public.staff where user_id is null and display_name = 'X'), 0::bigint, 'aucun membre créé par un non-gérant');
select tests.assert_eq((select retention_years from public.settings), 3, 'conservation inchangée');
