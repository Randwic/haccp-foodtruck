-- Lot 4 bis : traces (may_contain), cuisson à cœur, plats du menu, sous-recettes sans cycle,
-- allergènes calculés récursivement.

-- ---------------------------------------------------------------------------
-- Produits
-- ---------------------------------------------------------------------------
select tests.assert_eq((select may_contain from public.products where id = '00000000-0000-4000-8000-000000000401'), '{}'::text[],
  'produits existants : may_contain vide par défaut');
select tests.assert((select cook_min_c is null from public.products where id = '00000000-0000-4000-8000-000000000401'),
  'produits existants : cook_min_c null par défaut');
select tests.throws('produit : trace hors des 14 refusée', 'postgres', null,
  'insert into public.products (name, storage, may_contain) values (''A'', ''fridge'', ''{noix}'')', '%products_may_contain_check%');
select tests.throws('produit : trace en double refusée', 'postgres', null,
  'insert into public.products (name, storage, may_contain) values (''A'', ''fridge'', ''{soja,soja}'')', '%products_may_contain_check%');
select tests.throws('produit : trace null refusée', 'postgres', null,
  'insert into public.products (name, storage, may_contain) values (''A'', ''fridge'', array[null]::text[])', '%products_may_contain_check%');
select tests.throws('produit : allergène à la fois présent et en trace refusé', 'postgres', null,
  'insert into public.products (name, storage, allergens, may_contain) values (''A'', ''fridge'', ''{lait,gluten}'', ''{soja,lait}'')', '%products_may_contain_check%');
select tests.throws('produit : mise à jour créant un chevauchement refusée', 'postgres', null,
  'update public.products set may_contain = ''{gluten}'' where id = ''00000000-0000-4000-8000-000000000401''', '%products_may_contain_check%');
select tests.throws('produit : cuisson 39,9 °C refusée', 'postgres', null,
  'insert into public.products (name, storage, cook_min_c) values (''A'', ''fridge'', 39.9)', '%products_cook_min_check%');
select tests.throws('produit : cuisson 100,1 °C refusée', 'postgres', null,
  'insert into public.products (name, storage, cook_min_c) values (''A'', ''fridge'', 100.1)', '%products_cook_min_check%');
insert into public.products (id, name, storage, allergens, may_contain, cook_min_c) values
  ('0000004b-0000-4000-8000-000000000001', 'Poulet cuit', 'fridge', '{}', '{gluten,soja}', 74),
  ('0000004b-0000-4000-8000-000000000002', 'Pain brioché', 'ambient', '{gluten,oeufs,lait}', '{sesame,soja}', null),
  ('0000004b-0000-4000-8000-000000000003', 'Moutarde', 'fridge', '{moutarde}', '{}', 40),
  ('0000004b-0000-4000-8000-000000000004', 'Cheddar', 'fridge', '{lait}', '{}', 100);
select tests.assert_eq((select cook_min_c from public.products where id = '0000004b-0000-4000-8000-000000000001'), 74.0::numeric,
  'produit : cuisson 74 °C, traces disjointes, bornes 40 et 100 acceptées');

-- ---------------------------------------------------------------------------
-- Recettes : kind, category, durée de vie
-- ---------------------------------------------------------------------------
select tests.assert_eq((select kind || '|' || coalesce(category, '∅') || '|' || cardinality(ingredient_recipe_ids) from public.recipes
  where id = '00000000-0000-4000-8000-000000000451'), 'preparation|∅|0', 'recette existante : préparation, sans rubrique ni sous-recette');
select tests.throws('recette : kind inconnu refusé', 'postgres', null,
  'insert into public.recipes (name, kind, storage) values (''R'', ''plat'', ''fridge'')', '%recipes_kind_check%');
select tests.throws('préparation sans durée de vie refusée', 'postgres', null,
  'insert into public.recipes (name, kind, storage, shelf_life_hours) values (''R'', ''preparation'', ''fridge'', null)', '%recipes_shelf_life_check%');
select tests.throws('préparation de 2161 h refusée', 'postgres', null,
  'insert into public.recipes (name, storage, shelf_life_hours) values (''R'', ''fridge'', 2161)', '%recipes_shelf_life_check%');
select tests.throws('plat du menu avec durée de vie refusé', 'postgres', null,
  'insert into public.recipes (name, kind, storage, shelf_life_hours) values (''R'', ''menu_item'', ''fridge'', 24)', '%recipes_shelf_life_check%');
select tests.throws('rubrique de 41 caractères refusée', 'postgres', null,
  format('insert into public.recipes (name, kind, category, storage) values (''R'', ''menu_item'', %L, ''fridge'')', repeat('x', 41)), '%recipes_category_check%');
select tests.throws('recette : trace inconnue refusée', 'postgres', null,
  'insert into public.recipes (name, storage, shelf_life_hours, may_contain) values (''R'', ''fridge'', 24, ''{noix}'')', '%recipes_may_contain_check%');
select tests.throws('recette : 21 sous-recettes refusées', 'postgres', null,
  'insert into public.recipes (name, storage, shelf_life_hours, ingredient_recipe_ids) values (''R'', ''fridge'', 24, array_fill(''00000000-0000-4000-8000-000000000451''::uuid, array[21]))',
  '%recipes_sub_recipes_check%');
select tests.throws('recette : sous-recette null refusée', 'postgres', null,
  'insert into public.recipes (name, storage, shelf_life_hours, ingredient_recipe_ids) values (''R'', ''fridge'', 24, array[null]::uuid[])', '%recipes_sub_recipes_check%');

-- Graphe : A (préparation) ← B (préparation, contient A) ← Plat (menu, contient B)
insert into public.recipes (id, name, kind, storage, shelf_life_hours, ingredient_product_ids, extra_allergens, may_contain) values
  ('0000004c-0000-4000-8000-00000000000a', 'Sauce A', 'preparation', 'fridge', 72, '{0000004b-0000-4000-8000-000000000003}', '{oeufs}', '{celeri}');
insert into public.recipes (id, name, kind, storage, shelf_life_hours, ingredient_product_ids, ingredient_recipe_ids) values
  ('0000004c-0000-4000-8000-00000000000b', 'Sauce B', 'preparation', 'fridge', 48, '{0000004b-0000-4000-8000-000000000004}', '{0000004c-0000-4000-8000-00000000000a}');
insert into public.recipes (id, name, kind, category, storage, shelf_life_hours, ingredient_product_ids, ingredient_recipe_ids, may_contain) values
  ('0000004c-0000-4000-8000-0000000000f1', 'Plat', 'menu_item', 'Croq''Brioche', 'fridge', null,
   '{0000004b-0000-4000-8000-000000000001,0000004b-0000-4000-8000-000000000002}', '{0000004c-0000-4000-8000-00000000000b}', '{lait,arachides}');
select tests.assert(true, 'plat du menu : sous-recette de sous-recette acceptée, durée null');

select tests.throws('sous-recette inconnue refusée', 'postgres', null,
  'insert into public.recipes (name, storage, shelf_life_hours, ingredient_recipe_ids) values (''R'', ''fridge'', 24, ''{0000004c-0000-4000-8000-0000000000ff}'')',
  'HACCP: unknown_recipe%');
select tests.throws('un plat du menu ne peut pas être un ingrédient', 'postgres', null,
  'insert into public.recipes (name, kind, storage, ingredient_recipe_ids) values (''Menu'', ''menu_item'', ''fridge'', ''{0000004c-0000-4000-8000-0000000000f1}'')',
  'HACCP: invalid_sub_recipe%');
select tests.throws('cycle direct (A contient A) refusé', 'postgres', null,
  'update public.recipes set ingredient_recipe_ids = ''{0000004c-0000-4000-8000-00000000000a}'' where id = ''0000004c-0000-4000-8000-00000000000a''',
  'HACCP: recipe_cycle%');
select tests.throws('cycle indirect (A contient B qui contient A) refusé', 'postgres', null,
  'update public.recipes set ingredient_recipe_ids = ''{0000004c-0000-4000-8000-00000000000b}'' where id = ''0000004c-0000-4000-8000-00000000000a''',
  'HACCP: recipe_cycle%');
select tests.throws('cycle par le gérant (REST) refusé aussi', 'authenticated', tests.manager_uid(),
  'update public.recipes set ingredient_recipe_ids = ''{0000004c-0000-4000-8000-00000000000b,00000000-0000-4000-8000-000000000451}'' where id = ''0000004c-0000-4000-8000-00000000000a''',
  'HACCP: recipe_cycle%');
select tests.throws('une préparation utilisée ne devient pas un plat du menu', 'postgres', null,
  'update public.recipes set kind = ''menu_item'', shelf_life_hours = null where id = ''0000004c-0000-4000-8000-00000000000a''',
  'HACCP: recipe_in_use%');
update public.recipes set kind = 'menu_item', shelf_life_hours = null where id = '00000000-0000-4000-8000-000000000451';
select tests.assert(true, 'une préparation non utilisée peut devenir un plat du menu');
update public.recipes set ingredient_recipe_ids = '{}' where id = '0000004c-0000-4000-8000-00000000000b';
update public.recipes set ingredient_recipe_ids = '{0000004c-0000-4000-8000-00000000000b}' where id = '0000004c-0000-4000-8000-00000000000a';
select tests.assert(true, 'inversion du graphe (B ne contient plus A, A contient B) acceptée');
update public.recipes set ingredient_recipe_ids = '{}' where id = '0000004c-0000-4000-8000-00000000000a';
update public.recipes set ingredient_recipe_ids = '{0000004c-0000-4000-8000-00000000000a}' where id = '0000004c-0000-4000-8000-00000000000b';

-- ---------------------------------------------------------------------------
-- Allergènes calculés
-- Plat = Poulet (traces gluten, soja) + Pain (gluten, oeufs, lait ; traces sésame, soja)
--      + B (Cheddar : lait) + A (Moutarde : moutarde ; extra oeufs ; traces céleri)
--      + traces propres lait (présent → ignoré), arachides.
-- ---------------------------------------------------------------------------
select tests.assert_eq((select allergens from public.haccp_recipe_allergens('0000004c-0000-4000-8000-0000000000f1')),
  '{gluten,lait,moutarde,oeufs}'::text[], 'allergènes calculés récursivement (produits, sous-recettes, extra)');
select tests.assert_eq((select may_contain from public.haccp_recipe_allergens('0000004c-0000-4000-8000-0000000000f1')),
  '{arachides,celeri,sesame,soja}'::text[], 'traces calculées récursivement, moins les allergènes présents');
select tests.assert_eq((select count(*) from public.haccp_recipe_allergens('0000004c-0000-4000-8000-0000000000ee'))::int, 0,
  'recette inconnue : aucune ligne');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(),
  'select coalesce(array_to_string(allergens, '',''), ''∅'') from public.haccp_recipe_allergens(''0000004c-0000-4000-8000-0000000000f1'')'), null,
  'non-gérant : RLS, rien de calculé');
select tests.assert_eq(tests.value_as('service_role', null,
  'select array_to_string(allergens, '','') from public.haccp_recipe_allergens(''0000004c-0000-4000-8000-0000000000f1'')'), 'gluten,lait,moutarde,oeufs',
  'service_role : calcul disponible');
select tests.throws('anon ne calcule pas', 'anon', null,
  'select * from public.haccp_recipe_allergens(''0000004c-0000-4000-8000-0000000000f1'')', '%permission denied%');

-- Migration rejouée : données conservées
\ir ../../migrations/20261115000100_lot4bis_menu.sql
select tests.assert_eq((select kind || '|' || category from public.recipes where id = '0000004c-0000-4000-8000-0000000000f1'), 'menu_item|Croq''Brioche',
  'migration rejouée : plats du menu conservés');
