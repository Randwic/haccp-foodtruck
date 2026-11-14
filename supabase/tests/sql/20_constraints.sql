-- Contraintes de cohérence du registre et des références.

-- Gabarit : insertion d'un maillon device1 n° 3 valide, modifiable champ par champ.
create function tests.rec_sql(
  p_seq text default '3', p_prev text default null, p_hash text default null,
  p_type text default 'system_test', p_payload text default '''{}''', p_supersedes text default 'null',
  p_device uuid default null
) returns text language sql as $$
  select format(
    'insert into public.records (type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash, supersedes_id) '
    'values (%L, %s, %L, %L, %s, now(), %L, %L, %s)',
    p_type, p_payload, tests.staff1(), coalesce(p_device, tests.device1()), p_seq,
    coalesce(p_prev, (select hash from public.device_chain_head(coalesce(p_device, tests.device1())))),
    coalesce(p_hash, repeat('c', 64)), p_supersedes)
$$;

-- Le gabarit est valide (contrôle du témoin)
select tests.value_as('service_role', null, tests.rec_sql() || ' returning 1');
select tests.assert(true, 'gabarit d''insertion valide (service_role)');

-- Unicité (device_id, device_seq)
select tests.throws('doublon (device_id, device_seq)', 'service_role', null,
  tests.rec_sql(p_seq => '2', p_prev => (select hash from public.records where device_id = tests.device1() and device_seq = 1)),
  '%records_device_seq_unique%');
select tests.throws('doublon de genèse (seq 1)', 'service_role', null,
  tests.rec_sql(p_seq => '1', p_prev => tests.genesis()), '%records_device_seq_unique%');

-- Formats
select tests.throws('device_seq = 0',            'service_role', null, tests.rec_sql(p_seq => '0'),  '%records_device_seq_positive%');
select tests.throws('device_seq négatif',        'service_role', null, tests.rec_sql(p_seq => '-5'), '%records_device_seq_positive%');
select tests.throws('hash en majuscules',        'service_role', null, tests.rec_sql(p_hash => repeat('A', 64)), '%records_hash_format%');
select tests.throws('hash trop court',           'service_role', null, tests.rec_sql(p_hash => repeat('a', 63)), '%records_hash_format%');
select tests.throws('hash non hexadécimal',      'service_role', null, tests.rec_sql(p_hash => repeat('g', 64)), '%records_hash_format%');
select tests.throws('prev_hash mal formé',       'service_role', null, tests.rec_sql(p_prev => 'abc'),           '%records_prev_hash_format%');
select tests.throws('payload tableau',           'service_role', null, tests.rec_sql(p_payload => '''[1,2]'''),  '%records_payload_object%');
select tests.throws('payload chaîne',            'service_role', null, tests.rec_sql(p_payload => '''"x"'''),    '%records_payload_object%');
select tests.throws('payload null',              'service_role', null, tests.rec_sql(p_payload => 'null'),       '%null value%payload%');
select tests.throws('type inconnu',              'service_role', null, tests.rec_sql(p_type => 'hacked'),        '%records_type_check%');
select tests.throws('correction sans supersedes_id', 'service_role', null, tests.rec_sql(p_type => 'correction'), '%records_correction_link%');
select tests.throws('supersedes_id sans type correction', 'service_role', null,
  tests.rec_sql(p_supersedes => quote_literal((select id from public.records where device_seq = 1 and device_id = tests.device1()))),
  '%records_correction_link%');
select tests.throws('supersedes_id inexistant',  'service_role', null,
  tests.rec_sql(p_type => 'correction', p_supersedes => quote_literal(gen_random_uuid())), '%HACCP: supersedes_not_found%');
select tests.throws('auteur inconnu', 'service_role', null,
  replace(tests.rec_sql(), tests.staff1()::text, gen_random_uuid()::text), '%HACCP: unknown_author%');

-- Correction valide
select tests.value_as('service_role', null,
  tests.rec_sql(p_type => 'correction', p_payload => '''{"reason":"erreur de saisie"}''',
    p_supersedes => quote_literal((select id from public.records where device_seq = 1 and device_id = tests.device1())))
  || ' returning 1');
select tests.assert(true, 'correction valide acceptée');

-- Chaîne de hachage vérifiée en base
select tests.throws('trou dans la séquence', 'service_role', null, tests.rec_sql(p_seq => '5'), '%HACCP: seq_gap%');
select tests.throws('chaîne cassée (prev_hash faux)', 'service_role', null, tests.rec_sql(p_prev => repeat('e', 64)), '%HACCP: broken_chain%');
select tests.throws('genèse sans GENESIS_HASH', 'service_role', null,
  tests.rec_sql(p_seq => '1', p_prev => repeat('e', 64), p_device => tests.device2()), '%records_genesis%');
select tests.throws('premier maillon ≠ 1 sur appareil vierge', 'service_role', null,
  tests.rec_sql(p_seq => '2', p_prev => repeat('e', 64), p_device => tests.device2()), '%HACCP: seq_gap%');

-- server_time imposé par le serveur, clock_suspect calculé
select tests.exec_as('service_role', null, format(
  'insert into public.records (id, type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash, server_time, clock_suspect) '
  'values (%L, ''system_test'', ''{}'', %L, %L, 1, now() - interval ''2 hours'', %L, %L, ''2000-01-01'', false)',
  '11111111-1111-4111-8111-111111111111', tests.staff1(), tests.device2(), tests.genesis(), repeat('1', 64)));
select tests.assert((select server_time > now() - interval '1 minute' from public.records where id = '11111111-1111-4111-8111-111111111111'),
  'server_time fourni par le client ignoré');
select tests.assert((select clock_suspect from public.records where id = '11111111-1111-4111-8111-111111111111'),
  'clock_suspect = true si écart > clock_suspect_minutes');
select tests.exec_as('service_role', null, format(
  'insert into public.records (id, type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash) '
  'values (%L, ''system_test'', ''{}'', %L, %L, 2, now() - interval ''4 minutes'', %L, %L)',
  '22222222-2222-4222-8222-222222222222', tests.staff1(), tests.device2(), repeat('1', 64), repeat('2', 64)));
select tests.assert((select not clock_suspect from public.records where id = '22222222-2222-4222-8222-222222222222'),
  'clock_suspect = false si écart ≤ 5 min');

-- Appareil révoqué : insertion refusée
update public.devices set revoked_at = now() where id = tests.device2();
select tests.throws('appareil révoqué', 'service_role', null,
  tests.rec_sql(p_seq => '3', p_device => tests.device2()), '%HACCP: device_revoked%');
select tests.throws('révocation définitive', 'service_role', null,
  format('update public.devices set revoked_at = null where id = %L', tests.device2()), '%HACCP: révocation%définitive%');
select tests.throws('jeton d''appareil immuable', 'service_role', null,
  format('update public.devices set token_hash = repeat(''f'', 64) where id = %L', tests.device1()), '%HACCP: champs d''enrôlement%');

-- Références
select tests.throws('PIN : sel mal formé', 'service_role', null,
  format('insert into public.staff (display_name, pin_salt, pin_hash) values (''Bob'', ''abc'', %L)', tests.b64('h', 32)), '%staff_pin_salt_check%');
select tests.throws('PIN : hash mal formé', 'service_role', null,
  format('insert into public.staff (display_name, pin_salt, pin_hash) values (''Bob'', %L, ''1234'')', tests.b64('s', 16)), '%staff_pin_hash_check%');
select tests.throws('rôle staff inconnu', 'service_role', null,
  format('insert into public.staff (display_name, role, pin_salt, pin_hash) values (''Bob'', ''admin'', %L, %L)', tests.b64('s', 16), tests.b64('h', 32)), '%staff_role_check%');
select tests.throws('type d''équipement inconnu', 'service_role', null,
  'insert into public.equipment (name, kind) values (''Four'', ''oven'')', '%equipment_kind_check%');
select tests.throws('seuil min > max', 'service_role', null,
  'insert into public.thresholds (check_type, min_c, max_c) values (''hot_holding'', 70, 63)', '%thresholds_min_le_max%');
select tests.throws('seuil sans borne', 'service_role', null,
  'insert into public.thresholds (check_type) values (''hot_holding'')', '%thresholds_bound_present%');
select tests.throws('seuil en double (équipement, type)', 'service_role', null,
  'insert into public.thresholds (equipment_id, check_type, max_c) values (''00000000-0000-4000-8000-000000000101'', ''temperature_check'', 5)', '%thresholds_unique%');
select tests.exec_as('service_role', null, 'insert into public.thresholds (check_type, min_c) values (''hot_holding'', 63)');
select tests.throws('seuil générique en double (equipment_id null)', 'service_role', null,
  'insert into public.thresholds (check_type, min_c) values (''hot_holding'', 65)', '%thresholds_unique%');
select tests.throws('settings : une seule ligne', 'service_role', null,
  'insert into public.settings (id) values (2)', '%settings_id_check%');
select tests.throws('settings : conservation ≥ 1 an', 'service_role', null,
  'update public.settings set retention_years = 0', '%settings_retention_years_check%');
select tests.throws('un seul établissement', 'service_role', null,
  'insert into public.establishment (name) values (''Autre'')', '%establishment_singleton%');

-- Seed
select tests.assert_eq((select name from public.establishment), 'Mon Food Truck', 'seed : établissement');
select tests.assert_eq((select count(*) from public.equipment), 5::bigint, 'seed : 5 équipements');
select tests.assert_eq((select max_c from public.thresholds where equipment_id = '00000000-0000-4000-8000-000000000103'), -18.0, 'seed : congélateur −18 °C');
select tests.assert((select retention_years = 3 and auto_lock_minutes = 5 and clock_suspect_minutes = 5 and email_alerts from public.settings), 'seed : settings');
select tests.assert_eq((select count(*) from public.staff where id <> tests.staff1()), 0::bigint, 'seed : aucun membre d''équipe');
