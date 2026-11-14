-- Inscription unique du gérant : bootstrap_manager(), compteur anti-abus, staff.user_id.

-- État de départ : aucun gérant (le jeu commun en crée un).
delete from public.managers;
insert into auth.users (id, email) values
  ('0000000c-0000-4000-8000-00000000000c', 'premier@example.test'),
  ('0000000d-0000-4000-8000-00000000000d', 'second@example.test');

-- anon / authenticated : aucune fonction de bootstrap
select tests.throws('anon : bootstrap_manager interdit', 'anon', null,
  format('select public.bootstrap_manager(%L, ''X'', %L, %L, ''Camion'')',
    '0000000c-0000-4000-8000-00000000000c', tests.b64('s', 16), tests.b64('h', 32)), '%permission denied%');
select tests.throws('authenticated : bootstrap_manager interdit', 'authenticated', tests.user_uid(),
  format('select public.bootstrap_manager(%L, ''X'', %L, %L, ''Camion'')',
    '0000000c-0000-4000-8000-00000000000c', tests.b64('s', 16), tests.b64('h', 32)), '%permission denied%');
select tests.throws('anon : bootstrap_failure_count interdit', 'anon', null, 'select public.bootstrap_failure_count(15)', '%permission denied%');
select tests.throws('authenticated : bootstrap_record_failure interdit', 'authenticated', tests.user_uid(),
  'select public.bootstrap_record_failure(''x'')', '%permission denied%');
select tests.throws('authenticated ne lit pas bootstrap_attempts', 'authenticated', tests.manager_uid(),
  'select count(*) from public.bootstrap_attempts', '%permission denied%');
select tests.throws('service_role ne lit pas bootstrap_attempts directement', 'service_role', null,
  'select count(*) from public.bootstrap_attempts', '%permission denied%');
select tests.assert_eq((select count(*) from public.managers), 0::bigint, 'appels refusés : toujours aucun gérant');

-- Validation dans la fonction (filet de sécurité)
select tests.throws('display_name vide refusé', 'service_role', null,
  format('select public.bootstrap_manager(%L, ''  '', %L, %L, ''Camion'')',
    '0000000c-0000-4000-8000-00000000000c', tests.b64('s', 16), tests.b64('h', 32)), 'HACCP: invalid_request%');
select tests.throws('establishment_name trop long refusé', 'service_role', null,
  format('select public.bootstrap_manager(%L, ''Paul'', %L, %L, %L)',
    '0000000c-0000-4000-8000-00000000000c', tests.b64('s', 16), tests.b64('h', 32), repeat('x', 81)), 'HACCP: invalid_request%');
select tests.throws('PIN au mauvais format refusé (contrainte staff)', 'service_role', null,
  format('select public.bootstrap_manager(%L, ''Paul'', ''abc'', %L, ''Camion'')',
    '0000000c-0000-4000-8000-00000000000c', tests.b64('h', 32)), '%staff_pin_salt_check%');
select tests.throws('utilisateur Auth inexistant refusé', 'service_role', null,
  format('select public.bootstrap_manager(%L, ''Paul'', %L, %L, ''Camion'')',
    gen_random_uuid(), tests.b64('s', 16), tests.b64('h', 32)), '%foreign key%');
select tests.assert_eq((select count(*) from public.managers), 0::bigint, 'échecs : rien n''est créé (transaction annulée)');

-- Bootstrap OK
select tests.exec_as('service_role', null, format(
  'select set_config(''tests.staff_id'', public.bootstrap_manager(%L, ''  Paul '', %L, %L, '' Chez Paul '')::text, false)',
  '0000000c-0000-4000-8000-00000000000c', tests.b64('sel-paul', 16), tests.b64('pin-paul', 32)));
create temp table boot as select current_setting('tests.staff_id')::uuid as staff_id;
select tests.assert((select staff_id from boot) is not null, 'bootstrap OK (service_role) : staff_id renvoyé');
select tests.assert_eq((select count(*) from public.managers where user_id = '0000000c-0000-4000-8000-00000000000c'), 1::bigint, 'gérant inséré dans managers');
select tests.assert_eq(
  (select format('%s|%s|%s|%s', s.display_name, s.role, s.active, s.user_id) from public.staff s where s.id = (select staff_id from boot)),
  'Paul|manager|t|0000000c-0000-4000-8000-00000000000c', 'fiche staff : nom normalisé, rôle manager, actif, user_id lié');
select tests.assert_eq((select s.pin_hash from public.staff s where s.id = (select staff_id from boot)), tests.b64('pin-paul', 32), 'PIN fourni conservé');
select tests.assert_eq((select name from public.establishment), 'Chez Paul', 'établissement renommé');
select tests.assert(
  exists (select 1 from public.audit_log a where a.table_name = 'managers' and a.action = 'INSERT' and a.row_id = '0000000c-0000-4000-8000-00000000000c'),
  'audit : insertion du gérant journalisée');
select tests.assert(
  exists (select 1 from public.audit_log a where a.table_name = 'staff' and a.action = 'INSERT'
           and a.row_id = (select staff_id from boot)::text and a.new ->> 'pin_hash' = '***' and a.new ->> 'pin_salt' = '***'),
  'audit : fiche staff journalisée, PIN masqué');
select tests.assert(
  not exists (select 1 from public.audit_log a where a.new::text like '%' || tests.b64('pin-paul', 32) || '%'),
  'audit : le hash du PIN n''apparaît nulle part');

-- Le nouveau gérant est reconnu par la RLS
select tests.assert_eq(tests.value_as('authenticated', '0000000c-0000-4000-8000-00000000000c', 'select public.is_manager()'), 'true',
  'is_manager() vrai pour le gérant inscrit');
select tests.assert_eq(tests.value_as('authenticated', '0000000c-0000-4000-8000-00000000000c',
  'select count(*) from public.staff where role = ''manager'''), '1', 'le gérant inscrit lit sa fiche');

-- Second bootstrap refusé
select tests.throws('second bootstrap refusé', 'service_role', null,
  format('select public.bootstrap_manager(%L, ''Intrus'', %L, %L, ''Pirate'')',
    '0000000d-0000-4000-8000-00000000000d', tests.b64('s', 16), tests.b64('h', 32)), 'HACCP: already_bootstrapped%');
select tests.assert_eq((select count(*) from public.managers), 1::bigint, 'toujours un seul gérant');
select tests.assert_eq((select name from public.establishment), 'Chez Paul', 'établissement inchangé après refus');
select tests.assert_eq((select count(*) from public.staff where display_name = 'Intrus'), 0::bigint, 'aucune fiche staff créée par le refus');

-- staff.user_id : unique, on delete set null
select tests.throws('user_id unique', 'postgres', null,
  format('insert into public.staff (display_name, pin_salt, pin_hash, user_id) values (''Double'', %L, %L, %L)',
    tests.b64('s', 16), tests.b64('h', 32), '0000000c-0000-4000-8000-00000000000c'), '%staff_user_id_key%');
insert into public.staff (id, display_name, pin_salt, pin_hash, user_id)
values ('0000005e-0000-4000-8000-00000000000e', 'Lié', tests.b64('s', 16), tests.b64('h', 32), '0000000d-0000-4000-8000-00000000000d');
delete from auth.users where id = '0000000d-0000-4000-8000-00000000000d';
select tests.assert((select user_id is null from public.staff where id = '0000005e-0000-4000-8000-00000000000e'),
  'suppression du compte Auth : staff.user_id remis à null');

-- Compteur anti-abus (service_role uniquement)
select tests.assert_eq(tests.value_as('service_role', null, 'select public.bootstrap_failure_count(15)'), '0', 'aucun échec au départ');
select tests.exec_as('service_role', null, 'select public.bootstrap_record_failure(''invalid_request'')');
select tests.exec_as('service_role', null, 'select public.bootstrap_record_failure(''Raison Libre <script>'')');
select tests.assert_eq(tests.value_as('service_role', null, 'select public.bootstrap_failure_count(15)'), '2', 'deux échecs comptés');
select tests.assert_eq((select string_agg(reason, ',' order by id) from public.bootstrap_attempts), 'invalid_request,other',
  'raison non conforme remplacée par « other »');
insert into public.bootstrap_attempts (at, reason) values (now() - interval '20 minutes', 'old'), (now() - interval '2 days', 'very_old');
select tests.assert_eq(tests.value_as('service_role', null, 'select public.bootstrap_failure_count(15)'), '2', 'fenêtre de 15 minutes respectée');
select tests.exec_as('service_role', null, 'select public.bootstrap_record_failure(''email_exists'')');
select tests.assert_eq((select count(*) from public.bootstrap_attempts where reason = 'very_old'), 0::bigint, 'lignes de plus de 24 h nettoyées');
select tests.assert_eq((select count(*) from public.bootstrap_attempts where reason = 'old'), 1::bigint, 'lignes récentes conservées');
