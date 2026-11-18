-- =============================================================================
-- Space Diner — données réelles (livre du menu v43, tableau des allergènes,
-- classeur PMS de novembre 2026). Ce N'EST PAS une migration : script à exécuter
-- UNE FOIS sur le serveur, après toutes les migrations (dont …20261115000100_lot4bis_menu)
-- et le seed. Idempotent : le rejouer redonne le même état (les fiches qu'il gère sont
-- réécrites ; les autres ne sont pas touchées, sauf les exemples du seed, désactivés).
-- Aucun enregistrement du registre (records) n'est créé.
--
-- Exécution : SQL Editor de Supabase (coller tout le fichier) ou
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/data/space_diner_v43.sql
--
-- À FAIRE VALIDER PAR CÉDRIC (formation hygiène de décembre, fiches techniques) :
--   * allergènes « peut en contenir » des produits industriels (marqués « à vérifier
--     sur la fiche technique ») ; ils ont été choisis pour que le calcul donne
--     exactement le tableau des allergènes ;
--   * durées des préparations maison et tolérance de 20 min des enceintes froides.
-- Identifiants fixes : préfixe 5d000000-… (équipements …01xx, seuils …02xx,
-- produits …04xx, préparations …06xx, plats …07xx, nettoyage …08xx) ; les fiches
-- d'exemple du seed reprises gardent leur id (…0101-0105, …0401, …0402, …0405,
-- …0406, …0408, checklists …0551-0553).
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Établissement et réglages
-- ---------------------------------------------------------------------------
update public.establishment set name = 'Space Diner';
insert into public.establishment (id, name, timezone)
select '00000000-0000-4000-8000-000000000001', 'Space Diner', 'Europe/Paris'
 where not exists (select 1 from public.establishment);

-- Relevés : début de prépa (16 h 30) et fin de service (21 h).
insert into public.settings (id, daily_check_times) values (1, '{16:30,21:00}')
on conflict (id) do update set daily_check_times = excluded.daily_check_times;

-- ---------------------------------------------------------------------------
-- 2. Équipements (ni présentoir ni vitrine : la desserte réfrigérée sert de froid
--    de service ; la viande est tenue au bain-marie en bac GN pendant le service).
--    Les 5 équipements du seed sont renommés (même id) ; aucun n'est en trop.
-- ---------------------------------------------------------------------------
insert into public.equipment (id, name, kind, active) values
  ('00000000-0000-4000-8000-000000000101', 'Frigo inox 350 L',              'fridge',      true), -- viande : 0 à 3 °C
  ('00000000-0000-4000-8000-000000000102', 'Desserte réfrigérée 226 L',     'fridge',      true), -- 0 à 4 °C
  ('00000000-0000-4000-8000-000000000103', 'Congélateur inox 120 L',        'freezer',     true),
  ('00000000-0000-4000-8000-000000000104', 'Friteuse',                      'fryer_vat',   true), -- frites
  ('00000000-0000-4000-8000-000000000105', 'Friteuse d''appoint (nuggets)', 'fryer_vat',   true),
  ('5d000000-0000-4000-8000-000000000106', 'Bain-marie',                    'hot_holding', true), -- viande en bac GN, sauce cheddar, poivrons : ≥ 63 °C
  ('5d000000-0000-4000-8000-000000000107', 'Plancha',                       'other',       true),
  ('5d000000-0000-4000-8000-000000000108', 'Machine à sceller',             'other',       true)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, active = true;

-- Seuils des enceintes (tolérance de 20 min hors seuil avant alerte : À CONFIRMER).
insert into public.thresholds (id, equipment_id, check_type, min_c, max_c, tolerance_minutes) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 'temperature_check', null,   3, 20), -- viande : max 3 °C (PMS, point critique 1)
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000102', 'temperature_check', null,   4, 20), -- max 4 °C
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000103', 'temperature_check', null, -18, 20), -- max −18 °C
  ('5d000000-0000-4000-8000-000000000204', '5d000000-0000-4000-8000-000000000106', 'hot_holding',       63,  null, 20)  -- bain-marie ≥ 63 °C
on conflict on constraint thresholds_unique do update
  set min_c = excluded.min_c, max_c = excluded.max_c, tolerance_minutes = excluded.tolerance_minutes;

-- Seuils génériques des procédés (equipment_id null ; tolerance_minutes = durée maximale).
insert into public.thresholds (id, equipment_id, check_type, min_c, max_c, tolerance_minutes) values
  -- Cuisson / remise en température à cœur : 63 °C est le minimum (porc) ; le détail par
  -- produit est dans products.cook_min_c (poulet et nuggets 74 °C).
  ('00000000-0000-4000-8000-000000000212', null, 'cooking_check', 63, null,   0),
  -- Maintien au chaud ≥ 63 °C, 3 h maximum (PMS, point critique 6).
  ('00000000-0000-4000-8000-000000000211', null, 'hot_holding',   63, null, 180),
  -- Remise en température ≥ 63 °C en 60 min au plus.
  ('00000000-0000-4000-8000-000000000214', null, 'reheating',     63, null,  60)
on conflict on constraint thresholds_unique do update
  set min_c = excluded.min_c, max_c = excluded.max_c, tolerance_minutes = excluded.tolerance_minutes;

-- ---------------------------------------------------------------------------
-- 3. Produits achetés
--    shelf_life_opened_hours null = « selon l'étiquette du fabricant » (DLC saisie à la main).
--    shelf_life_thawed_hours null partout (aucune décongélation, cuisson directe), sauf le pain brioché.
--    storage : conservation du produit entamé (« frigo après ouverture » → fridge).
-- ---------------------------------------------------------------------------
-- Exemples du seed qui ne sont pas des produits de Space Diner.
update public.products set active = false
 where id in ('00000000-0000-4000-8000-000000000403',  -- Steak haché surgelé
              '00000000-0000-4000-8000-000000000404',  -- Sauce burger
              '00000000-0000-4000-8000-000000000407'); -- Salade iceberg

create temp table sd_product (id uuid primary key, name text not null unique) on commit drop;

with v (id, name, allergens, may_contain, storage, opened_h, cook_c) as (values
  -- Viandes fraîches déjà cuites (Metro), frigo 0 à 3 °C, une seule remise en température.
  ('5d000000-0000-4000-8000-000000000401'::uuid, 'Porc BBQ cuit', '{}'::text[],
     '{celeri,moutarde,sulfites}'::text[], 'fridge', null::int, 63::numeric),            -- traces : sauce BBQ, à vérifier sur la fiche technique
  ('5d000000-0000-4000-8000-000000000402', 'Émincé de poulet cuit', '{}',
     '{soja,celeri,moutarde,sulfites}', 'fridge', null, 74),                              -- traces : assaisonnement, à vérifier sur la fiche technique
  ('5d000000-0000-4000-8000-000000000403', 'Nuggets de poulet surgelés', '{gluten}',
     '{oeufs,lait}', 'freezer', null, 74),                                                -- panure : gluten ; traces à vérifier sur la fiche technique
  ('00000000-0000-4000-8000-000000000405', 'Frites fraîches précuites', '{}', '{}', 'fridge', null, null), -- DLC 21 jours ; après ouverture : étiquette
  ('5d000000-0000-4000-8000-000000000404', 'Trio poivrons surgelés', '{}', '{}', 'freezer', null, null),
  -- Pain et fromages
  -- Pain du boulanger (pas de DLC fabricant) : gardé 4 jours après l'achat ; le reste peut être congelé,
  -- décongelé à température ambiante et servi dans les 24 h (validé par Cédric le 18/11/2026).
  ('00000000-0000-4000-8000-000000000401', 'Pain brioché', '{gluten,oeufs,lait}', '{}', 'ambient', 96, 24),
  ('00000000-0000-4000-8000-000000000402', 'Cheddar en tranche', '{lait}', '{}', 'fridge', null, null),
  ('5d000000-0000-4000-8000-000000000405', 'Emmental en tranche', '{lait}', '{}', 'fridge', null, null),
  ('5d000000-0000-4000-8000-000000000406', 'Chèvre en rondelles', '{lait}', '{}', 'fridge', null, null),
  ('5d000000-0000-4000-8000-000000000407', 'Mascarpone', '{lait}', '{}', 'fridge', 72, null),            -- 3 jours maximum après ouverture
  ('5d000000-0000-4000-8000-000000000408', 'Crème liquide entière', '{lait}', '{}', 'fridge', null, null), -- « souvent 2 à 3 jours » : étiquette
  ('5d000000-0000-4000-8000-000000000409', 'Crème fraîche épaisse', '{lait}', '{}', 'fridge', null, null),
  -- Sauces et condiments achetés
  ('5d000000-0000-4000-8000-000000000410', 'Mayo Real Colona', '{oeufs,moutarde}', '{}', 'fridge', null, null), -- mayonnaise pasteurisée
  ('5d000000-0000-4000-8000-000000000411', 'Ketchup tomato Colona', '{}', '{celeri,moutarde}', 'fridge', null, null), -- épices : à vérifier sur la fiche technique
  ('5d000000-0000-4000-8000-000000000412', 'Moutarde de Dijon', '{moutarde}', '{sulfites}', 'fridge', null, null),   -- sulfites (conservateur) : à vérifier sur la fiche technique
  ('5d000000-0000-4000-8000-000000000413', 'Sauce Worcestershire', '{poissons}', '{gluten}', 'ambient', null, null),  -- anchois ; gluten (vinaigre de malt) selon la marque : à vérifier
  ('00000000-0000-4000-8000-000000000408', 'Cornichons aigre-doux', '{}', '{sulfites}', 'fridge', null, null),       -- à vérifier sur la fiche technique
  ('5d000000-0000-4000-8000-000000000414', 'Pickles d''oignons rouges', '{}', '{sulfites}', 'fridge', null, null),    -- à vérifier sur la fiche technique
  ('5d000000-0000-4000-8000-000000000415', 'Oignons frits', '{gluten}', '{}', 'ambient', null, null),                 -- enrobage farine de blé : à vérifier
  ('5d000000-0000-4000-8000-000000000416', 'Chutney d''oignons (pot 550 g)', '{}', '{moutarde,sulfites}', 'fridge', null, null), -- ambiant avant ouverture ; à vérifier (livre : « sulfites, moutarde »)
  ('00000000-0000-4000-8000-000000000406', 'Bacon croustillant (Sol y Tapas Crispy)', '{}', '{}', 'ambient', null, null), -- au sec ou au frigo selon l'étiquette ; à vérifier
  ('5d000000-0000-4000-8000-000000000417', 'Sauce cheddar (achetée)', '{lait}', '{gluten,sulfites}', 'fridge', null, null), -- tenue au chaud ≥ 63 °C au service ; à vérifier sur la fiche technique
  ('5d000000-0000-4000-8000-000000000418', 'Maïs en conserve', '{}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000419', 'Tomates séchées à l''huile', '{}', '{sulfites}', 'fridge', null, null), -- ambiant avant ouverture ; « souvent 7 jours » : étiquette ; à vérifier
  -- Desserts
  ('5d000000-0000-4000-8000-000000000420', 'Pommes cuites en cubes (Metro)', '{}', '{}', 'fridge', null, null),
  ('5d000000-0000-4000-8000-000000000421', 'Caramel beurre salé', '{lait}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000422', 'Coulis chocolat-noisette Sinigalia', '{fruits_a_coque,lait}', '{soja}', 'ambient', null, null), -- soja « selon marque »
  ('5d000000-0000-4000-8000-000000000423', 'Coulis de fruits rouges Sinigalia', '{}', '{}', 'fridge', null, null), -- « souvent frigo après ouverture »
  ('5d000000-0000-4000-8000-000000000424', 'Brownie', '{gluten,oeufs,lait,fruits_a_coque}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000425', 'Noisettes grillées concassées', '{fruits_a_coque}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000426', 'Amandes concassées', '{fruits_a_coque}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000427', 'Pâte d''amande', '{fruits_a_coque}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000428', 'Préparation crème pâtissière à froid (Ancel)', '{lait}', '{oeufs,soja}', 'ambient', null, null), -- « lait, œuf selon la préparation » ; à vérifier sur la fiche technique
  ('5d000000-0000-4000-8000-000000000429', 'Arôme amande amère sans alcool', '{}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000430', 'Crème de citron (lemon curd)', '{oeufs,lait}', '{}', 'fridge', null, null), -- frigo une fois ouvert
  ('5d000000-0000-4000-8000-000000000431', 'Galettes bretonnes', '{gluten,oeufs,lait}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000432', 'Meringues', '{oeufs}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000447', 'Sucre glace', '{}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000433', 'Miel', '{}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000434', 'Compote gourde', '{}', '{}', 'ambient', null, null),
  -- Herbes, épices, assaisonnements
  ('5d000000-0000-4000-8000-000000000435', 'Persil frais', '{}', '{}', 'fridge', 72, null), -- ciselé : 3 jours maximum
  ('5d000000-0000-4000-8000-000000000436', 'Paprika fumé', '{}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000437', 'Piment doux en poudre', '{}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000438', 'Ail en poudre', '{}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000439', 'Oignon en poudre', '{}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000440', 'Cannelle en poudre', '{}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000441', 'Sel fin', '{}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000442', 'Poivre noir', '{}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000443', 'Jus de citron', '{}', '{sulfites}', 'fridge', null, null), -- jus à base de concentré : à vérifier sur l'étiquette
  ('5d000000-0000-4000-8000-000000000444', 'Vinaigre de cidre', '{}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000445', 'Huile neutre', '{}', '{}', 'ambient', null, null),
  ('5d000000-0000-4000-8000-000000000446', 'Huile de friture', '{}', '{}', 'ambient', null, null)
),
up as (
  insert into public.products (id, name, allergens, may_contain, storage, shelf_life_opened_hours, shelf_life_thawed_hours, cook_min_c, active)
  select id, name, allergens, may_contain, storage, opened_h, null, cook_c, true from v
  on conflict (id) do update set
    name = excluded.name, allergens = excluded.allergens, may_contain = excluded.may_contain,
    storage = excluded.storage, shelf_life_opened_hours = excluded.shelf_life_opened_hours,
    shelf_life_thawed_hours = null, cook_min_c = excluded.cook_min_c, active = true
  returning id, name
)
insert into sd_product select id, name from up;

-- Noms → id (erreur si un nom est inconnu : protège contre une faute de frappe).
create or replace function pg_temp.sd_p(p_names text[]) returns uuid[]
language plpgsql as $$
declare
  v uuid[];
  v_missing text;
begin
  select n into v_missing from unnest(p_names) n where not exists (select 1 from sd_product s where s.name = n) limit 1;
  if v_missing is not null then raise exception 'space_diner_v43 : produit inconnu « % »', v_missing; end if;
  select array_agg(s.id order by o) into v from unnest(p_names) with ordinality u(n, o) join sd_product s on s.name = u.n;
  return coalesce(v, '{}');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Préparations maison (kind 'preparation') — durées du livre v43 / PMS, à valider
-- ---------------------------------------------------------------------------
-- Recette d'exemple du seed (Space Diner achète sa sauce cheddar toute prête).
update public.recipes set active = false where id = '00000000-0000-4000-8000-000000000451';

create temp table sd_recipe (id uuid primary key, name text not null unique) on commit drop;

with v (id, name, ingredients, extra, may, storage, hours) as (values
  -- 3 jours au frigo 0 à 4 °C : faite le jeudi, jetée le samedi soir (ramené de 5 à 3 jours, validé par Cédric le 18/11/2026).
  ('5d000000-0000-4000-8000-000000000601'::uuid, 'Sauce UFO fumée-miel',
     array['Paprika fumé', 'Piment doux en poudre', 'Ail en poudre', 'Oignon en poudre', 'Sel fin', 'Poivre noir',
           'Sauce Worcestershire', 'Cornichons aigre-doux', 'Miel', 'Ketchup tomato Colona', 'Moutarde de Dijon', 'Mayo Real Colona'],
     '{}'::text[], '{}'::text[], 'fridge', 72),
  -- 3 jours au frigo 0 à 4 °C (faite jeudi, jetée samedi soir).
  ('5d000000-0000-4000-8000-000000000602', 'Ranch',
     array['Jus de citron', 'Crème liquide entière', 'Mayo Real Colona', 'Ail en poudre', 'Persil frais', 'Sel fin', 'Poivre noir'],
     '{}', '{}', 'fridge', 72),
  ('5d000000-0000-4000-8000-000000000603', 'Sauce piquante fumée',
     array['Mayo Real Colona', 'Crème fraîche épaisse', 'Paprika fumé', 'Piment doux en poudre', 'Ail en poudre', 'Jus de citron', 'Sel fin'],
     '{}', '{}', 'fridge', 72),
  -- 1 mois en pot fermé, à température ambiante.
  ('5d000000-0000-4000-8000-000000000604', 'Miel piquant',
     array['Miel', 'Piment doux en poudre', 'Vinaigre de cidre'], '{}', '{}', 'ambient', 720),
  -- Chutney et bacon gardés séparés, mélangés au dernier moment ; le reste du mélange est jeté en fin de service (3 h).
  -- Le pot de chutney ouvert garde sa propre durée (10 jours, étiquette du fabricant). Cédric, 18/11/2026.
  ('5d000000-0000-4000-8000-000000000605', 'Chutney d''oignons au bacon',
     array['Bacon croustillant (Sol y Tapas Crispy)', 'Chutney d''oignons (pot 550 g)'], '{}', '{}', 'fridge', 3),
  -- Durée de l'étiquette du fournisseur après ouverture : 72 h retenues, À CONFIRMER.
  ('5d000000-0000-4000-8000-000000000606', 'Pommes cuites à la cannelle',
     array['Pommes cuites en cubes (Metro)', 'Cannelle en poudre'], '{}', '{}', 'fridge', 72),
  -- Faite à 16 h, jetée en fin de service (6 h) ; le livre indique « 24 h maximum ».
  ('5d000000-0000-4000-8000-000000000607', 'Crème pâtissière à l''amande',
     array['Préparation crème pâtissière à froid (Ancel)', 'Arôme amande amère sans alcool'], '{}', '{}', 'fridge', 6),
  -- Tenu au chaud ≥ 63 °C au bain-marie, 3 h maximum, jeté en fin de service, jamais remis au
  -- frigo. Le maintien au chaud n'est pas un mode de conservation du contrat : « ambient » est
  -- le plus proche (hors froid) ; la règle réelle est le seuil hot_holding.
  ('5d000000-0000-4000-8000-000000000608', 'Trio poivrons cuits',
     array['Trio poivrons surgelés', 'Huile neutre', 'Sel fin', 'Poivre noir'], '{}', '{}', 'ambient', 3)
),
up as (
  insert into public.recipes (id, name, kind, category, ingredient_product_ids, ingredient_recipe_ids, extra_allergens, may_contain, storage, shelf_life_hours, active)
  select id, name, 'preparation', null, pg_temp.sd_p(ingredients), '{}', extra, may, storage, hours, true from v
  on conflict (id) do update set
    name = excluded.name, kind = excluded.kind, category = excluded.category,
    ingredient_product_ids = excluded.ingredient_product_ids, ingredient_recipe_ids = excluded.ingredient_recipe_ids,
    extra_allergens = excluded.extra_allergens, may_contain = excluded.may_contain,
    storage = excluded.storage, shelf_life_hours = excluded.shelf_life_hours, active = true
  returning id, name
)
insert into sd_recipe select id, name from up;

create or replace function pg_temp.sd_r(p_names text[]) returns uuid[]
language plpgsql as $$
declare
  v uuid[];
  v_missing text;
begin
  select n into v_missing from unnest(p_names) n where not exists (select 1 from sd_recipe s where s.name = n) limit 1;
  if v_missing is not null then raise exception 'space_diner_v43 : préparation inconnue « % »', v_missing; end if;
  select array_agg(s.id order by o) into v from unnest(p_names) with ordinality u(n, o) join sd_recipe s on s.name = u.n;
  return coalesce(v, '{}');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Plats du menu (kind 'menu_item', shelf_life_hours null, storage sans objet : 'ambient',
--    servis tout de suite). Allergènes calculés = tableau des allergènes (vérifié par
--    supabase/tests/sql/96c_space_diner_v43.sql).
--    Seule trace propre à un plat : gluten sur les frites (friteuse commune aux frites et
--    aux nuggets, mention du tableau des allergènes).
-- ---------------------------------------------------------------------------
with v (id, name, category, products, preparations, may) as (values
  ('5d000000-0000-4000-8000-000000000701'::uuid, 'Supernova', 'Croq''Brioche',
     array['Pain brioché', 'Porc BBQ cuit', 'Cheddar en tranche', 'Cornichons aigre-doux', 'Oignons frits'],
     array['Sauce UFO fumée-miel', 'Chutney d''oignons au bacon'], '{}'::text[]),
  ('5d000000-0000-4000-8000-000000000702', 'Houston', 'Croq''Brioche',
     array['Pain brioché', 'Maïs en conserve', 'Porc BBQ cuit', 'Emmental en tranche', 'Pickles d''oignons rouges'],
     array['Sauce piquante fumée', 'Trio poivrons cuits'], '{}'),
  ('5d000000-0000-4000-8000-000000000703', 'Philadelphie', 'Croq''Brioche',
     array['Pain brioché', 'Sauce cheddar (achetée)', 'Porc BBQ cuit', 'Chutney d''oignons (pot 550 g)', 'Emmental en tranche'],
     array['Trio poivrons cuits'], '{}'),
  ('5d000000-0000-4000-8000-000000000704', 'Orion', 'Croq''Brioche',
     array['Pain brioché', 'Tomates séchées à l''huile', 'Émincé de poulet cuit', 'Chèvre en rondelles', 'Chutney d''oignons (pot 550 g)'],
     array['Miel piquant'], '{}'),
  ('5d000000-0000-4000-8000-000000000705', 'Alien', 'Croq''Brioche',
     array['Pain brioché', 'Tomates séchées à l''huile', 'Émincé de poulet cuit', 'Cheddar en tranche', 'Pickles d''oignons rouges'],
     array['Ranch'], '{}'),
  ('5d000000-0000-4000-8000-000000000706', 'Comète', 'Dessert',
     array['Pain brioché', 'Mascarpone', 'Noisettes grillées concassées', 'Caramel beurre salé'],
     array['Pommes cuites à la cannelle'], '{}'),
  ('5d000000-0000-4000-8000-000000000707', 'Aurore', 'Dessert',
     array['Pain brioché', 'Pâte d''amande', 'Amandes concassées', 'Coulis de fruits rouges Sinigalia'],
     array['Crème pâtissière à l''amande'], '{}'),
  ('5d000000-0000-4000-8000-000000000708', 'Pluton', 'Dessert',
     array['Pain brioché', 'Coulis chocolat-noisette Sinigalia', 'Brownie', 'Noisettes grillées concassées', 'Caramel beurre salé'],
     array[]::text[], '{}'),
  ('5d000000-0000-4000-8000-000000000709', 'Vénus', 'Dessert',
     array['Pain brioché', 'Mascarpone', 'Crème de citron (lemon curd)', 'Galettes bretonnes', 'Meringues', 'Sucre glace'],
     array[]::text[], '{}'),
  ('5d000000-0000-4000-8000-000000000710', 'Frites nature', 'Frites',
     array['Frites fraîches précuites', 'Sel fin', 'Huile de friture'], array[]::text[], '{gluten}'),
  ('5d000000-0000-4000-8000-000000000711', 'Frites Roswell', 'Frites',
     array['Frites fraîches précuites', 'Sel fin', 'Huile de friture', 'Sauce cheddar (achetée)', 'Bacon croustillant (Sol y Tapas Crispy)'],
     array[]::text[], '{gluten}'),
  ('5d000000-0000-4000-8000-000000000712', 'Barquette de frites nature', 'Frites',
     array['Frites fraîches précuites', 'Sel fin', 'Huile de friture'], array[]::text[], '{gluten}'),
  ('5d000000-0000-4000-8000-000000000713', 'Barquette de frites Roswell', 'Frites',
     array['Frites fraîches précuites', 'Sel fin', 'Huile de friture', 'Sauce cheddar (achetée)', 'Bacon croustillant (Sol y Tapas Crispy)'],
     array[]::text[], '{gluten}'),
  ('5d000000-0000-4000-8000-000000000714', 'Petit Martien', 'Menu enfant',
     array['Nuggets de poulet surgelés', 'Frites fraîches précuites', 'Sel fin', 'Huile de friture', 'Ketchup tomato Colona', 'Compote gourde'],
     array[]::text[], '{}')
)
insert into public.recipes (id, name, kind, category, ingredient_product_ids, ingredient_recipe_ids, extra_allergens, may_contain, storage, shelf_life_hours, active)
select id, name, 'menu_item', category, pg_temp.sd_p(products), pg_temp.sd_r(preparations), '{}', may, 'ambient', null, true from v
on conflict (id) do update set
  name = excluded.name, kind = excluded.kind, category = excluded.category,
  ingredient_product_ids = excluded.ingredient_product_ids, ingredient_recipe_ids = excluded.ingredient_recipe_ids,
  extra_allergens = excluded.extra_allergens, may_contain = excluded.may_contain,
  storage = excluded.storage, shelf_life_hours = null, active = true;

-- ---------------------------------------------------------------------------
-- 6. Plan de nettoyage (classeur PMS p. 11) — les 11 tâches d'exemple sont désactivées.
-- ---------------------------------------------------------------------------
update public.cleaning_tasks set active = false
 where id between '00000000-0000-4000-8000-000000000501' and '00000000-0000-4000-8000-000000000511';

insert into public.cleaning_tasks (id, name, frequency, product, method, active) values
  ('5d000000-0000-4000-8000-000000000801', 'Plancha', 'after_service', 'Dégraissant alimentaire',
   'Gratter, nettoyer, rincer, sécher.', true),
  ('5d000000-0000-4000-8000-000000000802', 'Friteuses', 'after_service', 'Dégraissant',
   'Friteuse et friteuse d''appoint : filtrer l''huile, nettoyer la cuve.', true),
  ('5d000000-0000-4000-8000-000000000803', 'Machine à sceller', 'after_service', 'Désinfectant alimentaire',
   'Entre un Croq''Brioche salé et un dessert : essuie-tout humide puis désinfectant (allergènes : lait, gluten, fruits à coque). Le soir : nettoyage complet.', true),
  ('5d000000-0000-4000-8000-000000000804', 'Plan de travail', 'after_service', 'Nettoyant, désinfectant',
   'Avant, pendant et après le service : nettoyer, rincer, désinfecter.', true),
  ('5d000000-0000-4000-8000-000000000805', 'Frigos et desserte', 'weekly', 'Désinfectant alimentaire',
   'Frigo inox 350 L et desserte réfrigérée 226 L : vider, nettoyer, désinfecter, rincer.', true),
  ('5d000000-0000-4000-8000-000000000806', 'Sonde du thermomètre', 'after_service', 'Lingette alimentaire',
   'Après chaque mesure : lingette propre.', true),
  ('5d000000-0000-4000-8000-000000000807', 'Lave-mains', 'daily', 'Savon',
   'Savon, réservoir d''eau propre rempli, eaux usées vidées.', true),
  ('5d000000-0000-4000-8000-000000000808', 'Vaisselle sale', 'after_service', 'Détergent',
   'Fin de service : bac sale fermé, lavage à la maison, retour en bac propre fermé.', true),
  ('5d000000-0000-4000-8000-000000000809', 'Poubelles et sols', 'daily', null,
   'Vider, nettoyer.', true)
on conflict (id) do update set
  name = excluded.name, frequency = excluded.frequency, product = excluded.product, method = excluded.method, active = true;

-- ---------------------------------------------------------------------------
-- 7. Checklists : Ouverture (prépa 16 h – 18 h 30) et Fermeture (fin de service) adaptées ;
--    Contrôle nuisibles conservé.
-- ---------------------------------------------------------------------------
insert into public.checklists (id, name, kind, items, active) values
  ('00000000-0000-4000-8000-000000000551', 'Ouverture (prépa 16 h – 18 h 30)', 'opening', '[
     {"id": "tenue",         "label": "Mains lavées, tenue propre, cheveux attachés", "required": true},
     {"id": "lave_mains",    "label": "Lave-mains : savon, papier, réservoir d''eau propre rempli, eaux usées vidées", "required": true},
     {"id": "temperatures",  "label": "Températures relevées vers 16 h 30 (frigo 350 L, desserte, congélateur)", "required": true},
     {"id": "plans_travail", "label": "Plan de travail nettoyé et désinfecté", "required": true},
     {"id": "dlc",           "label": "DLC et dates d''ouverture vérifiées (porc, poulet, frites, sauces maison)", "required": true},
     {"id": "preparations",  "label": "Préparations du jour faites, en bac fermé, étiquetées (nom, date et heure)", "required": true},
     {"id": "bain_marie",    "label": "Bain-marie à 63 °C minimum avant le service", "required": true},
     {"id": "huile",         "label": "Huile des friteuses contrôlée (couleur, odeur)", "required": true},
     {"id": "sonde",         "label": "Sonde du thermomètre propre", "required": true},
     {"id": "nuisibles",     "label": "Pas de nuisibles constatés", "required": true}
   ]'::jsonb, true),
  ('00000000-0000-4000-8000-000000000552', 'Fermeture (fin de service)', 'closing', '[
     {"id": "restes",           "label": "Restes réchauffés et tenus au chaud jetés (viande, poivrons, sauce cheddar)", "required": true},
     {"id": "flacons",          "label": "Flacons de sauce entamés jetés (jamais reversés dans le bac)", "required": true},
     {"id": "creme_patissiere", "label": "Crème pâtissière restante jetée", "required": true},
     {"id": "samedi",           "label": "Samedi : sauces maison froides et chutney au bacon restants jetés", "required": false},
     {"id": "produits_entames", "label": "Produits entamés fermés, étiquetés (date d''ouverture), au frigo", "required": true},
     {"id": "vaisselle",        "label": "Vaisselle sale dans le bac fermé", "required": true},
     {"id": "temperatures",     "label": "Températures relevées en fin de service", "required": true},
     {"id": "nettoyage",        "label": "Plancha, friteuses, machine à sceller et plan de travail nettoyés", "required": true},
     {"id": "poubelles",        "label": "Poubelles vidées, sol nettoyé", "required": true},
     {"id": "enceintes",        "label": "Frigo et desserte fermés", "required": true},
     {"id": "gaz",              "label": "Gaz et appareils de cuisson coupés", "required": true}
   ]'::jsonb, true)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, items = excluded.items, active = true;

update public.checklists set active = true where id = '00000000-0000-4000-8000-000000000553'; -- Contrôle nuisibles

commit;
