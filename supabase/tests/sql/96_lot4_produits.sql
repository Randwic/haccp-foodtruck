-- Lot 4 : produits, recettes (RLS, contraintes, audit, pas de suppression, seed),
-- index de traçabilité aval et trace_lot() (rappel produit).

-- ---------------------------------------------------------------------------
-- Données initiales
-- ---------------------------------------------------------------------------
select tests.assert_eq((select count(*) from public.products)::int, 8, 'seed : 8 produits (migration rejouée : idempotente)');
select tests.assert_eq((select count(*) from public.recipes)::int, 1, 'seed : 1 recette');
select tests.assert_eq((select allergens from public.products where name = 'Pain burger'), '{gluten,sesame}'::text[], 'seed : pain burger = gluten, sésame');
select tests.assert_eq((select allergens from public.products where name = 'Sauce burger'), '{oeufs,moutarde}'::text[], 'seed : sauce burger = œufs, moutarde');
update public.products set shelf_life_opened_hours = 24 where id = '00000000-0000-4000-8000-000000000402';
\ir ../../migrations/20261114001100_lot4_produits.sql
select tests.assert_eq((select shelf_life_opened_hours from public.products where id = '00000000-0000-4000-8000-000000000402'), 24,
  'migration rejouée : un produit modifié par le gérant n''est pas écrasé');

-- ---------------------------------------------------------------------------
-- RLS et privilèges (même régime que suppliers)
-- ---------------------------------------------------------------------------
select tests.assert((select relrowsecurity from pg_class where oid = 'public.products'::regclass), 'products : RLS activé');
select tests.assert((select relrowsecurity from pg_class where oid = 'public.recipes'::regclass), 'recipes : RLS activé');
select tests.throws('anon ne lit pas products', 'anon', null, 'select count(*) from public.products', '%permission denied%');
select tests.throws('anon ne lit pas recipes', 'anon', null, 'select count(*) from public.recipes', '%permission denied%');
select tests.throws('anon n''écrit pas products', 'anon', null, 'insert into public.products (name, storage) values (''X'', ''fridge'')', '%permission denied%');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from public.products'), '0', 'non-gérant ne voit aucun produit');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from public.recipes'), '0', 'non-gérant ne voit aucune recette');
select tests.throws('non-gérant n''ajoute pas de produit', 'authenticated', tests.user_uid(),
  'insert into public.products (name, storage) values (''Intrus'', ''fridge'')', '%row-level security%');
select tests.throws('non-gérant n''ajoute pas de recette', 'authenticated', tests.user_uid(),
  'insert into public.recipes (name, storage, shelf_life_hours) values (''Intrus'', ''fridge'', 24)', '%row-level security%');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(),
  'with u as (update public.products set name = ''Pirate'' returning 1) select count(*) from u'), '0', 'non-gérant ne modifie aucun produit');

select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from public.products'), '8', 'gérant lit les produits');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.products (name, allergens, storage, shelf_life_opened_hours) values (''Mayonnaise'', ''{oeufs,moutarde}'', ''fridge'', 72) returning 1) select count(*) from u'), '1',
  'gérant ajoute un produit');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.recipes (name, ingredient_product_ids, storage, shelf_life_hours) values (''Burger du chef'', ''{00000000-0000-4000-8000-000000000401,00000000-0000-4000-8000-000000000403}'', ''fridge'', 24) returning 1) select count(*) from u'), '1',
  'gérant ajoute une recette');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.products set active = false where name = ''Bacon en tranches'' returning 1) select count(*) from u'), '1',
  'gérant désactive un produit');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.products (id, name, storage) values (''00000000-0000-4000-8000-000000000401'', ''Pain brioché'', ''ambient'') on conflict (id) do update set name = excluded.name returning 1) select count(*) from u'), '1',
  'gérant : upsert d''un produit');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.recipes set active = false returning 1) select count(*) from u'), '1', 'gérant désactive une recette');
select tests.throws('gérant ne supprime pas de produit (aucun privilège DELETE)', 'authenticated', tests.manager_uid(), 'delete from public.products', '%permission denied%');
select tests.throws('gérant ne supprime pas de recette (aucun privilège DELETE)', 'authenticated', tests.manager_uid(), 'delete from public.recipes', '%permission denied%');
select tests.throws('propriétaire : suppression d''un produit bloquée', 'postgres', null, 'delete from public.products', 'HACCP: suppression interdite, products%');
select tests.throws('propriétaire : suppression d''une recette bloquée', 'postgres', null, 'delete from public.recipes', 'HACCP: suppression interdite, recipes%');
select tests.throws('propriétaire : TRUNCATE products bloqué', 'postgres', null, 'truncate public.products', 'HACCP: suppression interdite%');
select tests.throws('propriétaire : TRUNCATE recipes bloqué', 'postgres', null, 'truncate public.recipes', 'HACCP: suppression interdite%');

select tests.assert_eq(tests.value_as('service_role', null, 'select count(*) from public.products'), '8', 'service_role lit les produits (sync-pull, sync-push)');
select tests.assert_eq(tests.value_as('service_role', null, 'select count(*) from public.recipes'), '1', 'service_role lit les recettes');
select tests.throws('service_role n''écrit pas les produits', 'service_role', null, 'insert into public.products (name, storage) values (''X'', ''fridge'')', '%permission denied%');
select tests.throws('service_role ne modifie pas les recettes', 'service_role', null, 'update public.recipes set name = ''X''', '%permission denied%');

-- ---------------------------------------------------------------------------
-- Contraintes
-- ---------------------------------------------------------------------------
select tests.throws('produit : nom vide refusé', 'postgres', null, 'insert into public.products (name, storage) values (''  '', ''fridge'')', '%products_name_check%');
select tests.throws('produit : nom de 81 caractères refusé', 'postgres', null, format('insert into public.products (name, storage) values (%L, ''fridge'')', repeat('x', 81)), '%products_name_check%');
select tests.throws('produit : allergène hors des 14 refusé', 'postgres', null, 'insert into public.products (name, storage, allergens) values (''A'', ''fridge'', ''{noix}'')', '%products_allergens_check%');
select tests.throws('produit : allergène en majuscules refusé', 'postgres', null, 'insert into public.products (name, storage, allergens) values (''A'', ''fridge'', ''{Lait}'')', '%products_allergens_check%');
select tests.throws('produit : allergène en double refusé', 'postgres', null, 'insert into public.products (name, storage, allergens) values (''A'', ''fridge'', ''{lait,lait}'')', '%products_allergens_check%');
select tests.throws('produit : allergène null refusé', 'postgres', null, 'insert into public.products (name, storage, allergens) values (''A'', ''fridge'', array[''lait'', null])', '%products_allergens_check%');
select tests.throws('produit : tableau 2D refusé', 'postgres', null, 'insert into public.products (name, storage, allergens) values (''A'', ''fridge'', ''{{lait},{soja}}'')', '%products_allergens_check%');
select tests.throws('produit : allergens null refusé', 'postgres', null, 'insert into public.products (name, storage, allergens) values (''A'', ''fridge'', null)', '%null value%');
select tests.throws('produit : conservation inconnue refusée', 'postgres', null, 'insert into public.products (name, storage) values (''A'', ''cave'')', '%products_storage_check%');
select tests.throws('produit : durée après ouverture 0 h refusée', 'postgres', null, 'insert into public.products (name, storage, shelf_life_opened_hours) values (''A'', ''fridge'', 0)', '%products_opened_check%');
select tests.throws('produit : durée après décongélation 2161 h refusée', 'postgres', null, 'insert into public.products (name, storage, shelf_life_thawed_hours) values (''A'', ''fridge'', 2161)', '%products_thawed_check%');
insert into public.products (name, storage, allergens, shelf_life_opened_hours, shelf_life_thawed_hours)
values (repeat('é', 80), 'ambient',
        '{gluten,crustaces,oeufs,poissons,arachides,soja,lait,fruits_a_coque,celeri,moutarde,sesame,sulfites,lupin,mollusques}', 1, 2160);
select tests.assert(true, 'produit : 14 allergènes, nom de 80 caractères, durées 1 et 2160 h acceptés');

select tests.throws('recette : durée 0 h refusée', 'postgres', null, 'insert into public.recipes (name, storage, shelf_life_hours) values (''R'', ''fridge'', 0)', '%recipes_shelf_life_check%');
select tests.throws('recette : durée absente refusée', 'postgres', null, 'insert into public.recipes (name, storage) values (''R'', ''fridge'')', '%recipes_shelf_life_check%');
select tests.throws('recette : 2161 h refusée', 'postgres', null, 'insert into public.recipes (name, storage, shelf_life_hours) values (''R'', ''fridge'', 2161)', '%recipes_shelf_life_check%');
select tests.throws('recette : allergène supplémentaire inconnu refusé', 'postgres', null, 'insert into public.recipes (name, storage, shelf_life_hours, extra_allergens) values (''R'', ''fridge'', 24, ''{ail}'')', '%recipes_allergens_check%');
select tests.throws('recette : conservation inconnue refusée', 'postgres', null, 'insert into public.recipes (name, storage, shelf_life_hours) values (''R'', ''tiède'', 24)', '%recipes_storage_check%');
select tests.throws('recette : 51 ingrédients refusés', 'postgres', null,
  'insert into public.recipes (name, storage, shelf_life_hours, ingredient_product_ids) select ''R'', ''fridge'', 24, array_agg(''00000000-0000-4000-8000-000000000401''::uuid) from generate_series(1, 51)',
  '%recipes_ingredients_check%');
select tests.throws('recette : ingrédient null refusé', 'postgres', null,
  'insert into public.recipes (name, storage, shelf_life_hours, ingredient_product_ids) values (''R'', ''fridge'', 24, array[null::uuid])', '%recipes_ingredients_check%');
select tests.throws('recette : ingrédient inconnu refusé', 'postgres', null,
  'insert into public.recipes (name, storage, shelf_life_hours, ingredient_product_ids) values (''R'', ''fridge'', 24, ''{00000000-0000-4000-8000-0000000004ff}'')', 'HACCP: unknown_product%');
select tests.throws('recette : ingrédient inconnu refusé aussi en modification (gérant)', 'authenticated', tests.manager_uid(),
  'update public.recipes set ingredient_product_ids = ''{00000000-0000-4000-8000-0000000004ff}''', 'HACCP: unknown_product%');
insert into public.recipes (name, storage, shelf_life_hours, ingredient_product_ids)
select 'Cinquante', 'fridge', 2160, array_agg('00000000-0000-4000-8000-000000000406'::uuid) from generate_series(1, 50);
select tests.assert(true, 'recette : 50 ingrédients (dont produit désactivé) et 2160 h acceptés');

-- updated_at imposé, audit
insert into public.products (id, name, storage, updated_at) values ('00000000-0000-4000-8000-0000000004a1', 'Daté', 'fridge', '2000-01-01');
select tests.assert((select updated_at > '2001-01-01' from public.products where id = '00000000-0000-4000-8000-0000000004a1'), 'produit : updated_at imposé par le serveur');
insert into public.recipes (id, name, storage, shelf_life_hours, updated_at) values ('00000000-0000-4000-8000-0000000004a2', 'Datée', 'fridge', 24, '2000-01-01');
select tests.assert((select updated_at > '2001-01-01' from public.recipes where id = '00000000-0000-4000-8000-0000000004a2'), 'recette : updated_at imposé par le serveur');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'products' and action = 'INSERT' and row_id = '00000000-0000-4000-8000-0000000004a1'),
  'audit : insertion d''un produit journalisée');
select tests.exec_as('authenticated', tests.manager_uid(), 'update public.recipes set shelf_life_hours = 48 where id = ''00000000-0000-4000-8000-0000000004a2''');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'recipes' and action = 'UPDATE'
                             and row_id = '00000000-0000-4000-8000-0000000004a2' and actor = tests.manager_uid()::text),
  'audit : modification d''une recette par le gérant journalisée (acteur = gérant)');

-- ---------------------------------------------------------------------------
-- Traçabilité aval : trace_lot()
-- ---------------------------------------------------------------------------
create temporary table ids (k text primary key, id uuid);

insert into ids select 'recA', tests.add_record(tests.device1(), 'reception', null,
  '{"tag":"recA","supplier_id":"5b000000-0000-4000-8000-000000000001","items":[{"product":"Steak","lot":"L 2611-a"},{"product":"Pain","lot":"P1"}]}');
insert into ids select 'recB', tests.add_record(tests.device1(), 'reception', null,
  '{"tag":"recB","items":[{"product":"Cheddar","lot":"C9"}]}');
-- Correction de recA (le lot reste dans le remplacement).
insert into ids select 'corA', tests.add_record(tests.device1(), 'correction', (select id from ids where k = 'recA'),
  '{"reason":"DLC","replacement":{"tag":"corA","items":[{"product":"Steak","lot":"L2611-A"}]}}');
-- Étiquettes : par source_record_ids (original ou correction), par lot, sans lien.
insert into ids select 'labSrc', tests.add_record(tests.device1(), 'label_printed', null,
  jsonb_build_object('tag', 'labSrc', 'kind', 'thawed', 'source_record_ids', jsonb_build_array((select id from ids where k = 'recA'))));
insert into ids select 'labSrcCorr', tests.add_record(tests.device1(), 'label_printed', null,
  jsonb_build_object('tag', 'labSrcCorr', 'source_record_ids', jsonb_build_array((select id from ids where k = 'recB'), (select id from ids where k = 'corA'))));
insert into ids select 'labLot', tests.add_record(tests.device1(), 'label_printed', null, '{"tag":"labLot","lot":"  l2611-A "}');
insert into ids select 'labOther', tests.add_record(tests.device1(), 'label_printed', null,
  jsonb_build_object('tag', 'labOther', 'lot', 'C9', 'source_record_ids', jsonb_build_array((select id from ids where k = 'recB'))));
-- Correction d'une étiquette citant recA dans son remplacement.
insert into ids select 'labCorr', tests.add_record(tests.device1(), 'correction', (select id from ids where k = 'labOther'),
  jsonb_build_object('reason', 'r', 'replacement', jsonb_build_object('tag', 'labCorr', 'source_record_ids', jsonb_build_array((select id from ids where k = 'recA')))));
-- Pertes : par lot, liée à une réception, liée à une étiquette, sans lien.
insert into ids select 'wLot', tests.add_record(tests.device1(), 'waste', null, '{"tag":"wLot","lot":"L2611-a"}');
insert into ids select 'wRel', tests.add_record(tests.device1(), 'waste', null,
  jsonb_build_object('tag', 'wRel', 'related_record_id', (select id from ids where k = 'recA')));
insert into ids select 'wLab', tests.add_record(tests.device1(), 'waste', null,
  jsonb_build_object('tag', 'wLab', 'related_record_id', (select id from ids where k = 'labLot')));
insert into ids select 'wOther', tests.add_record(tests.device1(), 'waste', null,
  jsonb_build_object('tag', 'wOther', 'related_record_id', (select id from ids where k = 'recB')));
-- Lot présent dans un autre type (relevé) : ignoré.
insert into ids select 'temp', tests.add_record(tests.device1(), 'system_test', null, '{"tag":"temp","lot":"L2611-A"}');
-- Quarantaine : payload malformé (items texte, lot numérique) inséré sans erreur d'index ; réception
-- en quarantaine portant le lot : incluse et signalée.
insert into public.records (type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash, quarantine_reason)
select 'reception', '{"tag":"qBad","items":"L2611-A","lot":42}', tests.staff1(), tests.device1(), h.device_seq + 1, now(), h.hash, tests.hex('q-bad'), 'invalid_payload'
  from public.device_chain_head(tests.device1()) h;
insert into public.records (type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash, quarantine_reason)
select 'reception', jsonb_build_object('tag', 'qRec', 'items', jsonb_build_array(jsonb_build_object('lot', 'L2611-A'), jsonb_build_object('lot', repeat('x', 5000)))),
       tests.staff1(), tests.device1(), h.device_seq + 1, now(), h.hash, tests.hex('q-rec'), 'unknown_author'
  from public.device_chain_head(tests.device1()) h;
select tests.assert(true, 'index de lots : payloads malformés ou lot de 5000 caractères insérés sans erreur');

select tests.assert_eq(public.haccp_record_lots('{"items":[{"lot":" A b "},{"lot":"ab"},{"x":1}],"lot":"Z","replacement":{"lot":"y"}}'),
  '{ab,y,z}'::text[], 'haccp_record_lots : normalisé (casse, espaces), sans doublon, remplacement compris');

select tests.assert_eq(
  tests.value_as('authenticated', tests.manager_uid(),
    $q$select string_agg(kind || '/' || matched_by || '/' || coalesce(payload ->> 'tag', payload -> 'replacement' ->> 'tag'), ',' order by kind, coalesce(payload ->> 'tag', payload -> 'replacement' ->> 'tag'))
         from public.trace_lot('l2611 - a')$q$),
  'label_printed/source_record/labCorr,label_printed/lot/labLot,label_printed/source_record/labSrc,label_printed/source_record/labSrcCorr,'
  || 'reception/lot/corA,reception/lot/qRec,reception/lot/recA,waste/related_record/wLab,waste/lot/wLot,waste/related_record/wRel',
  'trace_lot : réceptions (corrections et quarantaine comprises), étiquettes et pertes liées ; rien d''autre');
select tests.assert_eq(
  tests.value_as('authenticated', tests.manager_uid(),
    $q$select string_agg(coalesce(payload ->> 'tag', payload -> 'replacement' ->> 'tag') || ':' || corrected || ':' || coalesce(quarantine_reason, '-') || ':' || record_type, ',' order by coalesce(payload ->> 'tag', payload -> 'replacement' ->> 'tag'))
         from public.trace_lot('L2611-A') where kind = 'reception'$q$),
  'corA:false:-:correction,qRec:false:unknown_author:reception,recA:true:-:reception',
  'trace_lot : signale les enregistrements corrigés et la quarantaine');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from public.trace_lot(''INCONNU'')'), '0',
  'trace_lot : lot inconnu → aucune ligne');
select tests.assert_eq(
  tests.value_as('authenticated', tests.manager_uid(),
    $q$select string_agg(payload ->> 'tag', ',' order by payload ->> 'tag') from public.trace_lot('c9')$q$),
  'labOther,labSrcCorr,recB,wOther', 'trace_lot : autre lot (étiquette par lot et par source, perte liée)');

select tests.throws('trace_lot : lot vide refusé', 'authenticated', tests.manager_uid(), 'select * from public.trace_lot(''   '')', 'HACCP: invalid_lot%');
select tests.throws('trace_lot : lot null refusé', 'authenticated', tests.manager_uid(), 'select * from public.trace_lot(null)', 'HACCP: invalid_lot%');
select tests.throws('trace_lot : non-gérant refusé', 'authenticated', tests.user_uid(), 'select * from public.trace_lot(''L2611-A'')', 'HACCP: forbidden%');
select tests.throws('trace_lot : anon refusé', 'anon', null, 'select * from public.trace_lot(''L2611-A'')', '%permission denied%');
select tests.throws('trace_lot : service_role refusé', 'service_role', null, 'select * from public.trace_lot(''L2611-A'')', '%permission denied%');
select tests.assert((select prosecdef from pg_proc where oid = 'public.trace_lot(text)'::regprocedure), 'trace_lot : SECURITY DEFINER');

-- Les index sont utilisables par les requêtes de traçabilité. Sur une table presque vide, le
-- planificateur préfère l'index générique sur `type` : on le retire de cette base jetable.
analyze public.records;
drop index public.records_type_idx;
set enable_seqscan = off;
create function pg_temp.plan(p_sql text) returns text language plpgsql as $$
declare v text; l text;
begin
  v := '';
  for l in execute 'explain ' || p_sql loop v := v || l || E'\n'; end loop;
  return v;
end $$;
select tests.assert(pg_temp.plan($q$select id from public.records where type in ('reception', 'waste', 'label_printed', 'correction')
                                   and public.haccp_record_lots(payload) @> array['l2611-a']$q$) like '%records_lots_idx%',
  'index records_lots_idx utilisé (réceptions contenant un lot)');
select tests.assert(pg_temp.plan($q$select id from public.records where type = 'label_printed'
                                   and payload -> 'source_record_ids' @> '["00000000-0000-4000-8000-000000000001"]'$q$) like '%records_label_sources_idx%',
  'index records_label_sources_idx utilisé (étiquettes citant une réception)');
select tests.assert(pg_temp.plan($q$select id from public.records where type = 'waste'
                                   and payload ->> 'related_record_id' = '00000000-0000-4000-8000-000000000001'$q$) like '%records_waste_related_idx%',
  'index records_waste_related_idx utilisé (pertes liées)');
reset enable_seqscan;
