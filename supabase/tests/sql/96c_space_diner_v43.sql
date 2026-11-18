-- Données réelles Space Diner (supabase/data/space_diner_v43.sql) : appliquées deux fois
-- (idempotence), quelques valeurs vérifiées, et contrôle des allergènes calculés
-- récursivement contre le tableau des allergènes (● présent, ○ peut en contenir).

create temp table before_counts as
  select (select count(*) from public.records) as records,
         (select count(*) from public.products) as products,
         (select count(*) from public.recipes) as recipes;

\ir ../../data/space_diner_v43.sql
\ir ../../data/space_diner_v43.sql
select tests.assert(true, 'script de données appliqué deux fois sans erreur (idempotent)');

select tests.assert_eq((select count(*) from public.records), (select records from before_counts),
  'aucun enregistrement du registre créé');

-- ---------------------------------------------------------------------------
-- Établissement, réglages, équipements, seuils
-- ---------------------------------------------------------------------------
select tests.assert_eq((select name from public.establishment), 'Space Diner', 'établissement « Space Diner »');
select tests.assert_eq((select daily_check_times from public.settings where id = 1), '{16:30,21:00}'::text[], 'relevés à 16:30 et 21:00');
select tests.assert_eq((select string_agg(name || ':' || kind, ', ' order by name) from public.equipment where active),
  'Bain-marie:hot_holding, Congélateur inox 120 L:freezer, Desserte réfrigérée 226 L:fridge, Frigo inox 350 L:fridge, '
  'Friteuse:fryer_vat, Friteuse d''appoint (nuggets):fryer_vat, Machine à sceller:other, Plancha:other',
  '8 équipements actifs (ni présentoir ni vitrine)');
select tests.assert_eq((select name from public.equipment where id = '00000000-0000-4000-8000-000000000101'), 'Frigo inox 350 L',
  'équipement du seed renommé (id réutilisé)');
select tests.assert_eq((select max_c::text || '/' || tolerance_minutes from public.thresholds t join public.equipment e on e.id = t.equipment_id
  where e.name = 'Frigo inox 350 L' and t.check_type = 'temperature_check'), '3.0/20', 'frigo inox 350 L : max 3 °C, tolérance 20 min');
select tests.assert_eq((select max_c::text from public.thresholds t join public.equipment e on e.id = t.equipment_id
  where e.name = 'Desserte réfrigérée 226 L' and t.check_type = 'temperature_check'), '4.0', 'desserte : max 4 °C');
select tests.assert_eq((select max_c::text from public.thresholds t join public.equipment e on e.id = t.equipment_id
  where e.name = 'Congélateur inox 120 L' and t.check_type = 'temperature_check'), '-18.0', 'congélateur : max −18 °C');
select tests.assert_eq((select min_c::text from public.thresholds t join public.equipment e on e.id = t.equipment_id
  where e.name = 'Bain-marie' and t.check_type = 'hot_holding'), '63.0', 'bain-marie : min 63 °C');
select tests.assert_eq((select string_agg(check_type || ':' || min_c || '/' || tolerance_minutes, ', ' order by check_type)
  from public.thresholds where equipment_id is null and check_type in ('cooking_check', 'hot_holding', 'reheating')),
  'cooking_check:63.0/0, hot_holding:63.0/180, reheating:63.0/60', 'seuils génériques : cuisson 63, maintien 63 (3 h), remise en température 63');

-- ---------------------------------------------------------------------------
-- Produits
-- ---------------------------------------------------------------------------
select tests.assert_eq((select string_agg(name, ', ' order by name) from public.products where id::text like '00000000-%' and not active),
  'Salade iceberg (sachet), Sauce burger, Steak haché surgelé', 'produits d''exemple du seed sans équivalent désactivés');
select tests.assert_eq((select name from public.products where id = '00000000-0000-4000-8000-000000000401'), 'Pain brioché', 'pain burger du seed → pain brioché');
select tests.assert_eq((select count(*) from public.products where active)::int, 52, '52 produits actifs');
select tests.assert_eq((select cook_min_c::text from public.products where name = 'Porc BBQ cuit'), '63.0', 'porc BBQ : 63 °C à cœur');
select tests.assert_eq((select cook_min_c::text from public.products where name = 'Émincé de poulet cuit'), '74.0', 'poulet : 74 °C à cœur');
select tests.assert_eq((select cook_min_c::text from public.products where name = 'Nuggets de poulet surgelés'), '74.0', 'nuggets : 74 °C à cœur');
select tests.assert_eq((select shelf_life_opened_hours from public.products where name = 'Mascarpone'), 72, 'mascarpone : 72 h après ouverture');
select tests.assert_eq((select shelf_life_opened_hours from public.products where name = 'Persil frais'), 72, 'persil ciselé : 72 h');
select tests.assert((select shelf_life_opened_hours is null from public.products where name = 'Porc BBQ cuit'), 'porc : après ouverture « selon l''étiquette » (null)');
select tests.assert_eq((select count(*) from public.products where active and shelf_life_thawed_hours is not null)::int, 0, 'aucune durée après décongélation');
select tests.assert_eq((select allergens || may_contain from public.products where name = 'Sauce Worcestershire'), '{poissons,gluten}'::text[],
  'Worcestershire : poisson, traces de gluten');

-- ---------------------------------------------------------------------------
-- Préparations
-- ---------------------------------------------------------------------------
select tests.assert_eq((select string_agg(name || ':' || shelf_life_hours || ':' || storage, ', ' order by name) from public.recipes
  where active and kind = 'preparation'),
  'Chutney d''oignons au bacon:3:fridge, Crème pâtissière à l''amande:6:fridge, Miel piquant:720:ambient, Pommes cuites à la cannelle:72:fridge, '
  'Ranch:72:fridge, Sauce UFO fumée-miel:72:fridge, Sauce piquante fumée:72:fridge, Trio poivrons cuits:3:ambient',
  '8 préparations maison et leurs durées');
select tests.assert(not (select active from public.recipes where id = '00000000-0000-4000-8000-000000000451'), 'recette d''exemple du seed désactivée');
select tests.assert_eq((select array_to_string(a.allergens, ',') || ' | ' || array_to_string(a.may_contain, ',')
  from public.recipes r, public.haccp_recipe_allergens(r.id) a where r.name = 'Sauce UFO fumée-miel'),
  'moutarde,oeufs,poissons | celeri,gluten,sulfites', 'sauce UFO : œuf, moutarde, poisson ; traces gluten, céleri, sulfites');

-- ---------------------------------------------------------------------------
-- Plats du menu : contrôle contre le tableau des allergènes
-- ---------------------------------------------------------------------------
select tests.assert_eq((select count(*) from public.recipes where active and kind = 'menu_item' and shelf_life_hours is null)::int, 14,
  '14 plats du menu, sans durée de vie');
select tests.assert_eq((select string_agg(distinct category, ', ' order by category) from public.recipes where active and kind = 'menu_item'),
  'Croq''Brioche, Dessert, Frites, Menu enfant', 'rubriques du menu');

create temp table expected (name text primary key, present text[], traces text[]);
insert into expected values
  -- CROQ'BRIOCHE
  ('Supernova',    '{gluten,oeufs,poissons,lait,moutarde}', '{celeri,sulfites}'),
  ('Houston',      '{gluten,oeufs,lait,moutarde}',          '{celeri,sulfites}'),
  ('Philadelphie', '{gluten,oeufs,lait}',                   '{celeri,moutarde,sulfites}'),
  ('Orion',        '{gluten,oeufs,lait}',                   '{soja,celeri,moutarde,sulfites}'),
  ('Alien',        '{gluten,oeufs,lait,moutarde}',          '{soja,celeri,sulfites}'),
  -- DESSERTS
  ('Comète',       '{gluten,oeufs,lait,fruits_a_coque}',    '{}'),
  ('Aurore',       '{gluten,oeufs,lait,fruits_a_coque}',    '{soja}'),
  ('Pluton',       '{gluten,oeufs,lait,fruits_a_coque}',    '{soja}'),
  ('Vénus',        '{gluten,oeufs,lait}',                   '{}'),
  -- FRITES ET MENU ENFANT
  ('Frites nature',               '{}',       '{gluten}'),
  ('Barquette de frites nature',  '{}',       '{gluten}'),
  ('Frites Roswell',              '{lait}',   '{gluten,sulfites}'),
  ('Barquette de frites Roswell', '{lait}',   '{gluten,sulfites}'),
  ('Petit Martien',               '{gluten}', '{oeufs,lait,celeri,moutarde}');

do $$
declare
  v_bad text;
begin
  select string_agg(format('%s : calculé %s / %s, attendu %s / %s', e.name, a.allergens, a.may_contain,
                           (select coalesce(array_agg(x order by x), '{}') from unnest(e.present) x),
                           (select coalesce(array_agg(x order by x), '{}') from unnest(e.traces) x)), E'\n')
    into v_bad
    from expected e
    left join public.recipes r on r.name = e.name and r.kind = 'menu_item' and r.active
    left join lateral public.haccp_recipe_allergens(r.id) a on true
   where r.id is null
      or a.allergens is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(e.present) x)
      or a.may_contain is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(e.traces) x);
  if v_bad is not null then
    raise exception 'ÉCHEC : allergènes calculés ≠ tableau des allergènes :%', E'\n' || v_bad;
  end if;
  raise notice 'ok - allergènes et traces calculés = tableau des allergènes, pour les 14 plats (aucun écart)';
end $$;
select tests.assert_eq((select count(*) from public.recipes r where r.active and r.kind = 'menu_item'
  and r.name not in (select name from expected))::int, 0, 'chaque plat actif figure dans le tableau des allergènes');

-- ---------------------------------------------------------------------------
-- Nettoyage et checklists
-- ---------------------------------------------------------------------------
select tests.assert_eq((select count(*) from public.cleaning_tasks where active and id::text like '00000000-%')::int, 0, 'tâches d''exemple désactivées');
select tests.assert_eq((select string_agg(name || ':' || frequency, ', ' order by name) from public.cleaning_tasks where active),
  'Frigos et desserte:weekly, Friteuses:after_service, Lave-mains:daily, Machine à sceller:after_service, Plan de travail:after_service, '
  'Plancha:after_service, Poubelles et sols:daily, Sonde du thermomètre:after_service, Vaisselle sale:after_service',
  '9 tâches du classeur PMS');
select tests.assert((select method like '%salé et un dessert%' from public.cleaning_tasks where name = 'Machine à sceller'),
  'machine à sceller : nettoyage entre salé et dessert');
select tests.assert_eq((select string_agg(kind, ',' order by kind) from public.checklists where active), 'closing,opening,pest_control',
  'checklists Ouverture, Fermeture, Contrôle nuisibles actives');
select tests.assert((select items @> '[{"id": "flacons"}]' from public.checklists where kind = 'closing' and active),
  'fermeture : flacons entamés jetés');
