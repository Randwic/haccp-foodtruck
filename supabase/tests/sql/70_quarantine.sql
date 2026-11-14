-- Quarantaine : enregistrements refusés pour leur contenu, stockés, immuables,
-- et faisant avancer la chaîne. Les erreurs de chaîne ne sont jamais stockées.

-- Insère (en service_role) le maillon suivant de device1 avec les valeurs données.
create function tests.q_sql(
  p_reason text, p_type text default 'system_test', p_payload text default '''{}''',
  p_author uuid default null, p_supersedes text default 'null',
  p_seq_offset int default 1, p_prev text default null, p_hash text default null
) returns text language sql as $$
  select format(
    'insert into public.records (id, type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash, supersedes_id, quarantine_reason) '
    'values (gen_random_uuid(), %L, %s, %L, %L, %s, now(), %L, %L, %s, %L)',
    p_type, p_payload, coalesce(p_author, tests.staff1()), tests.device1(),
    (select device_seq from public.device_chain_head(tests.device1())) + p_seq_offset,
    coalesce(p_prev, (select hash from public.device_chain_head(tests.device1()))),
    coalesce(p_hash, tests.hex(gen_random_uuid()::text)), p_supersedes, p_reason)
$$;

create function tests.q_head() returns bigint language sql as $$
  select device_seq from public.device_chain_head(tests.device1())
$$;

-- Hors quarantaine, chaque défaut de contenu est refusé
select tests.throws('auteur inconnu refusé hors quarantaine', 'service_role', null,
  tests.q_sql(null, p_author => gen_random_uuid()), '%HACCP: unknown_author%');
select tests.throws('type inconnu refusé hors quarantaine', 'service_role', null,
  tests.q_sql(null, p_type => 'futur_type'), '%records_type_check%');
select tests.throws('payload non objet refusé hors quarantaine', 'service_role', null,
  tests.q_sql(null, p_payload => '''[1]'''), '%records_payload_object%');
select tests.throws('correction orpheline refusée hors quarantaine', 'service_role', null,
  tests.q_sql(null, p_type => 'correction', p_supersedes => quote_literal(gen_random_uuid())), '%HACCP: supersedes_not_found%');

-- En quarantaine : stockés et la chaîne avance
select tests.exec_as('service_role', null, tests.q_sql('unknown_author', p_author => '99999999-9999-4999-8999-999999999999'));
select tests.assert_eq(tests.q_head(), 3::bigint, 'quarantaine unknown_author stockée, tête = 3');
select tests.assert((select author_id = '99999999-9999-4999-8999-999999999999' from public.records where device_seq = 3 and device_id = tests.device1()),
  'author_id d''origine conservé (hash recalculable)');

select tests.exec_as('service_role', null, tests.q_sql('unknown_type', p_type => 'futur_type'));
select tests.assert_eq(tests.q_head(), 4::bigint, 'quarantaine unknown_type stockée, tête = 4');

select tests.exec_as('service_role', null, tests.q_sql('invalid_payload', p_payload => '''[1,2]'''));
select tests.assert_eq(tests.q_head(), 5::bigint, 'quarantaine invalid_payload (payload non objet) stockée');

select tests.exec_as('service_role', null, tests.q_sql('invalid_payload', p_type => 'correction'));
select tests.assert_eq(tests.q_head(), 6::bigint, 'correction mal formée (sans supersedes_id) stockée en quarantaine');

select tests.exec_as('service_role', null, tests.q_sql('invalid_payload', p_type => 'temperature_check',
  p_supersedes => quote_literal((select id from public.records where device_id = tests.device1() and device_seq = 1))));
select tests.assert_eq(tests.q_head(), 7::bigint, 'supersedes_id sur un type non correction stocké en quarantaine');

select tests.exec_as('service_role', null, tests.q_sql('supersedes_not_found', p_type => 'correction',
  p_supersedes => quote_literal('88888888-8888-4888-8888-888888888888')));
select tests.assert_eq(tests.q_head(), 8::bigint, 'quarantaine supersedes_not_found stockée');
select tests.assert((select supersedes_id = '88888888-8888-4888-8888-888888888888' from public.records where device_seq = 8 and device_id = tests.device1()),
  'supersedes_id d''origine conservé');

-- La chaîne continue normalement après la quarantaine
select tests.exec_as('service_role', null, tests.q_sql(null));
select tests.assert_eq(tests.q_head(), 9::bigint, 'maillon normal accepté après des quarantaines');

-- Valeurs de quarantaine contrôlées ; les erreurs de chaîne ne sont jamais stockées
select tests.throws('raison de quarantaine inconnue', 'service_role', null,
  tests.q_sql('broken_chain'), '%records_quarantine_reason_check%');
select tests.throws('quarantaine : chaîne cassée refusée', 'service_role', null,
  tests.q_sql('invalid_payload', p_prev => repeat('e', 64)), '%HACCP: broken_chain%');
select tests.throws('quarantaine : trou refusé', 'service_role', null,
  tests.q_sql('invalid_payload', p_seq_offset => 2), '%HACCP: seq_gap%');
select tests.throws('quarantaine : hash invalide refusé', 'service_role', null,
  tests.q_sql('invalid_payload', p_hash => 'zz'), '%records_hash_format%');
select tests.throws('quarantaine : doublon de séquence refusé', 'service_role', null,
  tests.q_sql('invalid_payload', p_seq_offset => 0,
    p_prev => (select hash from public.records where device_id = tests.device1() and device_seq = 8)), '%records_device_seq_unique%');
select tests.throws('quarantaine : type démesuré refusé', 'service_role', null,
  tests.q_sql('unknown_type', p_type => repeat('x', 101)), '%records_type_length%');
select tests.throws('quarantaine : appareil révoqué toujours refusé', 'service_role', null,
  replace(tests.q_sql('invalid_payload'), tests.device1()::text, tests.device2()::text), '%HACCP:%');

-- Immuables comme le reste du registre
select tests.throws('quarantaine immuable (UPDATE)', 'postgres', null,
  'update public.records set quarantine_reason = null where quarantine_reason is not null', '%HACCP:%UPDATE interdit%');
select tests.throws('quarantaine immuable (DELETE)', 'postgres', null,
  'delete from public.records where quarantine_reason is not null', '%HACCP:%DELETE interdit%');
select tests.throws('gérant ne lève pas une quarantaine', 'authenticated', tests.manager_uid(),
  'update public.records set quarantine_reason = null', '%permission denied%');

-- Examen par le gérant
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'select count(*) from public.records where quarantine_reason is not null'), '6', 'gérant voit les 6 enregistrements en quarantaine');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(),
  'select count(*) from public.records where quarantine_reason is not null'), '0', 'non-gérant ne voit pas la quarantaine');
select tests.assert(exists (select 1 from pg_indexes where indexname = 'records_quarantine_idx'
                              and indexdef ilike '%where (quarantine_reason is not null)%'), 'index partiel de quarantaine présent');

-- Le domaine record_type (seuils) utilise la même liste
select tests.throws('seuil avec type inconnu refusé', 'service_role', null,
  'insert into public.thresholds (check_type, max_c) values (''futur_type'', 4)', '%record_type_check%');

-- Une correction peut viser un enregistrement en quarantaine
select tests.exec_as('service_role', null, tests.q_sql(null, p_type => 'correction', p_payload => '''{"reason":"auteur corrigé"}''',
  p_supersedes => quote_literal((select id from public.records where device_id = tests.device1() and device_seq = 3))));
select tests.assert_eq(tests.q_head(), 10::bigint, 'correction d''un enregistrement en quarantaine acceptée');
