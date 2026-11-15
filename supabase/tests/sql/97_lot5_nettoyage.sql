-- Lot 5 : plan de nettoyage et checklists (RLS, contraintes, audit, pas de suppression, seed).

-- ---------------------------------------------------------------------------
-- Données initiales
-- ---------------------------------------------------------------------------
select tests.assert_eq((select count(*) from public.cleaning_tasks)::int, 11, 'seed : 11 tâches de nettoyage (migration rejouée : idempotente)');
select tests.assert_eq((select count(*) from public.checklists)::int, 3, 'seed : 3 checklists');
select tests.assert_eq((select string_agg(kind, ',' order by kind) from public.checklists), 'closing,opening,pest_control', 'seed : ouverture, fermeture, nuisibles');
select tests.assert_eq((select jsonb_array_length(items) from public.checklists where kind = 'closing'), 7, 'seed : fermeture = 7 points');
select tests.assert_eq((select frequency from public.cleaning_tasks where name = 'Congélateur — dégivrage'), 'monthly', 'seed : congélateur mensuel');
select tests.assert_eq((select frequency from public.cleaning_tasks where name = 'Friteuse — vidange et nettoyage du bac'), 'weekly', 'seed : vidange friteuse hebdomadaire par défaut');
select tests.assert((select bool_and(method like '%PMS%') from public.cleaning_tasks), 'seed : méthodes « à adapter selon votre PMS »');
update public.cleaning_tasks set frequency = 'daily' where id = '00000000-0000-4000-8000-000000000504';
update public.checklists set active = false where id = '00000000-0000-4000-8000-000000000553';
\ir ../../migrations/20261114001300_lot5_nettoyage.sql
select tests.assert_eq((select frequency from public.cleaning_tasks where id = '00000000-0000-4000-8000-000000000504'), 'daily',
  'migration rejouée : une tâche modifiée par le gérant n''est pas écrasée');
select tests.assert_eq((select active from public.checklists where id = '00000000-0000-4000-8000-000000000553'), false,
  'migration rejouée : une checklist désactivée reste désactivée');

-- ---------------------------------------------------------------------------
-- RLS et privilèges (même régime que suppliers / products)
-- ---------------------------------------------------------------------------
select tests.assert((select relrowsecurity from pg_class where oid = 'public.cleaning_tasks'::regclass), 'cleaning_tasks : RLS activé');
select tests.assert((select relrowsecurity from pg_class where oid = 'public.checklists'::regclass), 'checklists : RLS activé');
select tests.throws('anon ne lit pas cleaning_tasks', 'anon', null, 'select count(*) from public.cleaning_tasks', '%permission denied%');
select tests.throws('anon ne lit pas checklists', 'anon', null, 'select count(*) from public.checklists', '%permission denied%');
select tests.throws('anon n''écrit pas cleaning_tasks', 'anon', null, 'insert into public.cleaning_tasks (name, frequency) values (''X'', ''daily'')', '%permission denied%');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from public.cleaning_tasks'), '0', 'non-gérant ne voit aucune tâche');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from public.checklists'), '0', 'non-gérant ne voit aucune checklist');
select tests.throws('non-gérant n''ajoute pas de tâche', 'authenticated', tests.user_uid(),
  'insert into public.cleaning_tasks (name, frequency) values (''Intrus'', ''daily'')', '%row-level security%');
select tests.throws('non-gérant n''ajoute pas de checklist', 'authenticated', tests.user_uid(),
  'insert into public.checklists (name, kind, items) values (''Intrus'', ''other'', ''[{"id":"a","label":"A","required":true}]'')', '%row-level security%');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(),
  'with u as (update public.checklists set name = ''Pirate'' returning 1) select count(*) from u'), '0', 'non-gérant ne modifie aucune checklist');

select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from public.cleaning_tasks'), '11', 'gérant lit les tâches');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.cleaning_tasks (name, frequency, product, method) values (''Vitrine réfrigérée'', ''daily'', null, null) returning 1) select count(*) from u'), '1',
  'gérant ajoute une tâche (produit et méthode facultatifs)');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.checklists (name, kind, items) values (''Livraison'', ''other'', ''[{"id":"camion","label":"Camion propre","required":false}]'') returning 1) select count(*) from u'), '1',
  'gérant ajoute une checklist');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.cleaning_tasks set active = false where name = ''Sols'' returning 1) select count(*) from u'), '1',
  'gérant désactive une tâche');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  $q$with u as (update public.checklists set items = items || '[{"id":"extincteur","label":"Extincteur accessible","required":false}]' where kind = 'opening' returning 1) select count(*) from u$q$), '1',
  'gérant ajoute un point à une checklist');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.cleaning_tasks (id, name, frequency) values (''00000000-0000-4000-8000-000000000507'', ''Sols et marchepied'', ''daily'') on conflict (id) do update set name = excluded.name returning 1) select count(*) from u'), '1',
  'gérant : upsert d''une tâche');
select tests.throws('gérant ne supprime pas de tâche (aucun privilège DELETE)', 'authenticated', tests.manager_uid(), 'delete from public.cleaning_tasks', '%permission denied%');
select tests.throws('gérant ne supprime pas de checklist (aucun privilège DELETE)', 'authenticated', tests.manager_uid(), 'delete from public.checklists', '%permission denied%');
select tests.throws('propriétaire : suppression d''une tâche bloquée', 'postgres', null, 'delete from public.cleaning_tasks', 'HACCP: suppression interdite, cleaning_tasks%');
select tests.throws('propriétaire : suppression d''une checklist bloquée', 'postgres', null, 'delete from public.checklists', 'HACCP: suppression interdite, checklists%');
select tests.throws('propriétaire : TRUNCATE cleaning_tasks bloqué', 'postgres', null, 'truncate public.cleaning_tasks', 'HACCP: suppression interdite%');
select tests.throws('propriétaire : TRUNCATE checklists bloqué', 'postgres', null, 'truncate public.checklists', 'HACCP: suppression interdite%');

select tests.assert_eq(tests.value_as('service_role', null, 'select count(*) from public.cleaning_tasks'), '11', 'service_role lit les tâches (sync-pull, sync-push)');
select tests.assert_eq(tests.value_as('service_role', null, 'select count(*) from public.checklists'), '3', 'service_role lit les checklists');
select tests.throws('service_role n''écrit pas les tâches', 'service_role', null, 'insert into public.cleaning_tasks (name, frequency) values (''X'', ''daily'')', '%permission denied%');
select tests.throws('service_role ne modifie pas les checklists', 'service_role', null, 'update public.checklists set name = ''X''', '%permission denied%');

-- ---------------------------------------------------------------------------
-- Contraintes : tâches
-- ---------------------------------------------------------------------------
select tests.throws('tâche : nom vide refusé', 'postgres', null, 'insert into public.cleaning_tasks (name, frequency) values (''  '', ''daily'')', '%cleaning_tasks_name_check%');
select tests.throws('tâche : nom de 81 caractères refusé', 'postgres', null, format('insert into public.cleaning_tasks (name, frequency) values (%L, ''daily'')', repeat('x', 81)), '%cleaning_tasks_name_check%');
select tests.throws('tâche : fréquence inconnue refusée', 'postgres', null, 'insert into public.cleaning_tasks (name, frequency) values (''A'', ''yearly'')', '%cleaning_tasks_frequency_check%');
select tests.throws('tâche : fréquence absente refusée', 'postgres', null, 'insert into public.cleaning_tasks (name) values (''A'')', '%null value%');
select tests.throws('tâche : produit de 81 caractères refusé', 'postgres', null, format('insert into public.cleaning_tasks (name, frequency, product) values (''A'', ''daily'', %L)', repeat('p', 81)), '%cleaning_tasks_product_check%');
select tests.throws('tâche : méthode de 501 caractères refusée', 'postgres', null, format('insert into public.cleaning_tasks (name, frequency, method) values (''A'', ''daily'', %L)', repeat('m', 501)), '%cleaning_tasks_method_check%');
insert into public.cleaning_tasks (name, frequency, product, method) values (repeat('é', 80), 'after_service', repeat('p', 80), repeat('m', 500));
select tests.assert(true, 'tâche : nom 80, produit 80, méthode 500 caractères acceptés');

-- ---------------------------------------------------------------------------
-- Contraintes : checklists (points en jsonb)
-- ---------------------------------------------------------------------------
create function pg_temp.items_ok(p jsonb) returns boolean language sql as $$ select public.haccp_valid_checklist_items(p) $$;
select tests.assert(pg_temp.items_ok('[{"id":"a-1_b","label":"Point","required":false}]'), 'points : un point valide');
select tests.assert(pg_temp.items_ok((select jsonb_agg(jsonb_build_object('id', 'p' || i, 'label', repeat('é', 120), 'required', true)) from generate_series(1, 40) i)),
  'points : 40 points, libellé de 120 caractères, id distincts');
select tests.assert(pg_temp.items_ok(jsonb_build_array(jsonb_build_object('id', repeat('a', 40), 'label', 'L', 'required', true))), 'points : id de 40 caractères');
select tests.assert(not pg_temp.items_ok('[]'), 'points : tableau vide refusé');
select tests.assert(not pg_temp.items_ok((select jsonb_agg(jsonb_build_object('id', 'p' || i, 'label', 'L', 'required', true)) from generate_series(1, 41) i)), 'points : 41 refusés');
select tests.assert(not pg_temp.items_ok('{"id":"a","label":"L","required":true}'), 'points : objet au lieu d''un tableau refusé');
select tests.assert(not pg_temp.items_ok('[{"id":"a","label":"L","required":true},{"id":"a","label":"M","required":false}]'), 'points : id en double refusé');
select tests.assert(not pg_temp.items_ok('[{"id":"A","label":"L","required":true}]'), 'points : id en majuscules refusé');
select tests.assert(not pg_temp.items_ok('[{"id":"a b","label":"L","required":true}]'), 'points : id avec espace refusé');
select tests.assert(not pg_temp.items_ok('[{"id":"","label":"L","required":true}]'), 'points : id vide refusé');
select tests.assert(not pg_temp.items_ok(jsonb_build_array(jsonb_build_object('id', repeat('a', 41), 'label', 'L', 'required', true))), 'points : id de 41 caractères refusé');
select tests.assert(not pg_temp.items_ok('[{"id":1,"label":"L","required":true}]'), 'points : id numérique refusé');
select tests.assert(not pg_temp.items_ok('[{"id":"a","label":"   ","required":true}]'), 'points : libellé blanc refusé');
select tests.assert(not pg_temp.items_ok(jsonb_build_array(jsonb_build_object('id', 'a', 'label', repeat('x', 121), 'required', true))), 'points : libellé de 121 caractères refusé');
select tests.assert(not pg_temp.items_ok('[{"id":"a","label":"L","required":"oui"}]'), 'points : required non booléen refusé');
select tests.assert(not pg_temp.items_ok('[{"id":"a","label":"L"}]'), 'points : required absent refusé');
select tests.assert(not pg_temp.items_ok('[{"id":"a","label":"L","required":true,"x":1}]'), 'points : clé inconnue refusée');
select tests.assert(not pg_temp.items_ok('["a"]'), 'points : élément non objet refusé');
select tests.throws('checklist : points invalides refusés par la contrainte', 'postgres', null,
  'insert into public.checklists (name, kind, items) values (''C'', ''other'', ''[]'')', '%checklists_items_check%');
select tests.throws('checklist : points absents refusés', 'postgres', null,
  'insert into public.checklists (name, kind) values (''C'', ''other'')', '%null value%');
select tests.throws('checklist : nature inconnue refusée', 'postgres', null,
  'insert into public.checklists (name, kind, items) values (''C'', ''hygiene'', ''[{"id":"a","label":"L","required":true}]'')', '%checklists_kind_check%');
select tests.throws('checklist : nom vide refusé', 'postgres', null,
  'insert into public.checklists (name, kind, items) values ('''', ''other'', ''[{"id":"a","label":"L","required":true}]'')', '%checklists_name_check%');
select tests.throws('gérant : modification avec un point en double refusée', 'authenticated', tests.manager_uid(),
  $q$update public.checklists set items = items || '[{"id":"gaz","label":"Doublon","required":true}]' where kind = 'closing'$q$, '%checklists_items_check%');

-- updated_at imposé, audit
insert into public.cleaning_tasks (id, name, frequency, updated_at) values ('00000000-0000-4000-8000-0000000005a1', 'Datée', 'daily', '2000-01-01');
select tests.assert((select updated_at > '2001-01-01' from public.cleaning_tasks where id = '00000000-0000-4000-8000-0000000005a1'), 'tâche : updated_at imposé par le serveur');
insert into public.checklists (id, name, kind, items, updated_at) values ('00000000-0000-4000-8000-0000000005a2', 'Datée', 'other', '[{"id":"a","label":"L","required":true}]', '2000-01-01');
select tests.assert((select updated_at > '2001-01-01' from public.checklists where id = '00000000-0000-4000-8000-0000000005a2'), 'checklist : updated_at imposé par le serveur');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'cleaning_tasks' and action = 'INSERT' and row_id = '00000000-0000-4000-8000-0000000005a1'),
  'audit : insertion d''une tâche journalisée');
select tests.exec_as('authenticated', tests.manager_uid(), 'update public.checklists set name = ''Renommée'' where id = ''00000000-0000-4000-8000-0000000005a2''');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'checklists' and action = 'UPDATE'
                             and row_id = '00000000-0000-4000-8000-0000000005a2' and actor = tests.manager_uid()::text),
  'audit : modification d''une checklist par le gérant journalisée (acteur = gérant)');

-- Les types du lot 5 sont connus du registre (hors quarantaine).
select tests.assert(public.haccp_known_record_type('cleaning_done') and public.haccp_known_record_type('checklist_done')
                    and public.haccp_known_record_type('oil_check') and public.haccp_known_record_type('oil_change'),
  'types cleaning_done, checklist_done, oil_check, oil_change connus');
