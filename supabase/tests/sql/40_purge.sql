-- Purge de fin de conservation : ne supprime que l'expiré, reste cohérente avec
-- supersedes_id, mémorise l'ancre de chaîne et journalise.

-- Jeu de données daté : on désactive temporairement (en tant que propriétaire, dans
-- une transaction de test) le trigger qui impose server_time = now().
begin;
alter table public.records disable trigger records_before_insert;

-- Appareil 1 : seq 1 et 2 viennent du jeu commun (récents). On les vieillit pas :
-- on utilise l'appareil 2 et un appareil 3 dédiés.
insert into public.devices (id, name, token_hash) values
  ('000000d3-0000-4000-8000-000000000003', 'Ancien iPad', tests.hex('jeton-3'));

-- Appareil 2 :
--  A seq1 (4 ans)                       -> purgé
--  B seq2 (4 ans)                       -> conservé (corrigé par C, récent)
--  C seq3 (1 an, correction de B)       -> conservé
--  E seq4 (5 ans)                       -> purgé (corrigé par F, expiré aussi)
--  F seq5 (4 ans, correction de E)      -> purgé
--  G seq6 (4 ans) corrigé par H (4 ans) corrigé par I (récent) -> G, H conservés
--  J seq9 (2 ans 11 mois)               -> conservé (pas encore expiré)
insert into public.records (id, type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash, supersedes_id, server_time) values
  ('a0000000-0000-4000-8000-00000000000a', 'temperature_check', '{}', tests.staff1(), tests.device2(), 1, now() - interval '4 years', tests.genesis(), repeat('a', 64), null, now() - interval '4 years'),
  ('b0000000-0000-4000-8000-00000000000b', 'temperature_check', '{}', tests.staff1(), tests.device2(), 2, now() - interval '4 years', repeat('a', 64), repeat('b', 64), null, now() - interval '4 years'),
  ('c0000000-0000-4000-8000-00000000000c', 'correction', '{"reason":"x"}', tests.staff1(), tests.device2(), 3, now() - interval '1 year', repeat('b', 64), repeat('c', 64), 'b0000000-0000-4000-8000-00000000000b', now() - interval '1 year'),
  ('e0000000-0000-4000-8000-00000000000e', 'reception', '{}', tests.staff1(), tests.device2(), 4, now() - interval '5 years', repeat('c', 64), repeat('e', 64), null, now() - interval '5 years'),
  ('f0000000-0000-4000-8000-00000000000f', 'correction', '{"reason":"x"}', tests.staff1(), tests.device2(), 5, now() - interval '4 years', repeat('e', 64), repeat('f', 64), 'e0000000-0000-4000-8000-00000000000e', now() - interval '4 years'),
  ('10000000-0000-4000-8000-000000000001', 'cleaning_done', '{}', tests.staff1(), tests.device2(), 6, now() - interval '4 years', repeat('f', 64), repeat('1', 64), null, now() - interval '4 years'),
  ('20000000-0000-4000-8000-000000000002', 'correction', '{"reason":"x"}', tests.staff1(), tests.device2(), 7, now() - interval '4 years', repeat('1', 64), repeat('2', 64), '10000000-0000-4000-8000-000000000001', now() - interval '4 years'),
  ('30000000-0000-4000-8000-000000000003', 'correction', '{"reason":"x"}', tests.staff1(), tests.device2(), 8, now(), repeat('2', 64), repeat('3', 64), '20000000-0000-4000-8000-000000000002', now()),
  ('90000000-0000-4000-8000-000000000009', 'oil_check', '{}', tests.staff1(), tests.device2(), 9, now() - interval '2 years 11 months', repeat('3', 64), repeat('9', 64), null, now() - interval '2 years 11 months');

-- Appareil 3 : tout est expiré -> chaîne entièrement purgée, ancre = seq 2
insert into public.records (id, type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash, server_time) values
  ('d3000000-0000-4000-8000-000000000001', 'system_test', '{}', tests.staff1(), '000000d3-0000-4000-8000-000000000003', 1, now() - interval '6 years', tests.genesis(), repeat('4', 64), now() - interval '6 years'),
  ('d3000000-0000-4000-8000-000000000002', 'system_test', '{}', tests.staff1(), '000000d3-0000-4000-8000-000000000003', 2, now() - interval '6 years', repeat('4', 64), repeat('5', 64), now() - interval '6 years');

alter table public.records enable trigger records_before_insert;
commit;

select tests.assert_eq((select count(*) from public.records), 13::bigint, 'jeu de purge : 13 enregistrements');

-- Exécution (via service_role, comme le ferait une Edge Function ; pg_cron l'appelle en propriétaire)
select tests.assert_eq(tests.value_as('service_role', null, 'select 1')::int, 1, 'service_role disponible');
select tests.exec_as('service_role', null, 'create temporary table _purge_result as select public.purge_expired_records() as n');
select tests.assert_eq((select n from _purge_result), 5::bigint, 'purge : 5 enregistrements supprimés (A, E, F, ancien iPad ×2)');

select tests.assert(not exists (select 1 from public.records where id in (
  'a0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-00000000000e', 'f0000000-0000-4000-8000-00000000000f',
  'd3000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002')), 'purge : expirés non référencés supprimés');
select tests.assert((select count(*) = 6 from public.records where id in (
  'b0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000c',
  '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003',
  '90000000-0000-4000-8000-000000000009')), 'purge : récents et expirés référencés par une correction conservés');
select tests.assert_eq((select count(*) from public.records where device_id = tests.device1()), 2::bigint, 'purge : appareil 1 intact');

-- Journalisation
select tests.assert((select count(*) = 1 from public.audit_log where action = 'PURGE'), 'purge journalisée dans audit_log');
select tests.assert((select (new ->> 'deleted')::int = 5 and (new ->> 'retention_years')::int = 3
                       and (new ->> 'kept_expired_referenced')::int = 3 and actor = 'system:purge'
                       and (new -> 'by_type' ->> 'system_test')::int = 2
                       from public.audit_log where action = 'PURGE'), 'résumé de purge complet');

-- Ancres de chaîne
select tests.assert_eq((select device_seq from public.record_chain_anchors where device_id = '000000d3-0000-4000-8000-000000000003'), 2::bigint,
  'ancre : dernier maillon purgé de l''ancien iPad');
select tests.assert_eq((select device_seq from public.record_chain_anchors where device_id = tests.device2()), 5::bigint,
  'ancre : appareil 2 = seq 5 (F)');
select tests.assert_eq((select hash from public.device_chain_head('000000d3-0000-4000-8000-000000000003')), repeat('5', 64),
  'device_chain_head renvoie l''ancre si tout est purgé');
select tests.assert_eq((select device_seq from public.device_chain_head(tests.device2())), 9::bigint,
  'device_chain_head(appareil 2) = dernier enregistrement réel');

-- La chaîne continue après purge, et reste vérifiée
select tests.throws('après purge : prev_hash faux refusé', 'service_role', null,
  format('insert into public.records (type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash) values (''system_test'', ''{}'', %L, ''000000d3-0000-4000-8000-000000000003'', 3, now(), %L, repeat(''6'', 64))',
    tests.staff1(), repeat('4', 64)), '%HACCP: broken_chain%');
select tests.throws('après purge : trou après l''ancre refusé', 'service_role', null,
  format('insert into public.records (type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash) values (''system_test'', ''{}'', %L, ''000000d3-0000-4000-8000-000000000003'', 4, now(), %L, repeat(''6'', 64))',
    tests.staff1(), repeat('5', 64)), '%HACCP: seq_gap%');
select tests.exec_as('service_role', null,
  format('insert into public.records (type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash) values (''system_test'', ''{}'', %L, ''000000d3-0000-4000-8000-000000000003'', 3, now(), %L, repeat(''6'', 64))',
    tests.staff1(), repeat('5', 64)));
select tests.assert(true, 'après purge : maillon suivant l''ancre accepté');

-- Deuxième passage : rien à supprimer, mais journalisé ; l'ancre ne recule pas
select tests.assert_eq(public.purge_expired_records(), 0::bigint, 'deuxième purge : rien à supprimer');
select tests.assert_eq((select count(*) from public.audit_log where action = 'PURGE'), 2::bigint, 'deuxième purge journalisée');
select tests.assert_eq((select device_seq from public.record_chain_anchors where device_id = tests.device2()), 5::bigint, 'ancre inchangée');

-- Après expiration de C, B est purgé avec C ; G-H restent tant que I est conservé
begin;
alter table public.records disable trigger records_no_update;
update public.records set server_time = now() - interval '3 years 1 day' where id = 'c0000000-0000-4000-8000-00000000000c';
alter table public.records enable trigger records_no_update;
commit;
select tests.assert_eq(public.purge_expired_records(), 2::bigint, 'purge cohérente : correction expirée + original supprimés ensemble');
select tests.assert(exists (select 1 from public.records where id = '10000000-0000-4000-8000-000000000001'), 'chaîne de corrections G→H→I conservée');

-- Réduire la conservation est journalisé (audit des settings)
update public.settings set retention_years = 1;
select tests.assert(exists (select 1 from public.audit_log where table_name = 'settings' and action = 'UPDATE'
                             and (old ->> 'retention_years')::int = 3 and (new ->> 'retention_years')::int = 1),
  'changement de durée de conservation journalisé');
select tests.assert_eq(public.purge_expired_records(), 1::bigint, 'conservation 1 an : J (2 ans 11 mois) purgé');
