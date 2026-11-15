-- =============================================================================
-- HACCP Food Truck — lot 4 bis (menu réel)
--  1. products : `may_contain` (traces « peut en contenir », disjoint de `allergens`)
--     et `cook_min_c` (température à cœur minimale, 40..100 °C).
--  2. recipes : `kind` ('preparation' | 'menu_item'), `category` (rubrique du menu),
--     `ingredient_recipe_ids` (sous-recettes : préparations existantes, sans cycle),
--     `may_contain`, `shelf_life_hours` nullable (préparation 1..2160, plat du menu null).
--  3. haccp_recipe_allergens(id) : allergènes et traces calculés récursivement.
--  Migration idempotente (rejouable).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Produits
-- ---------------------------------------------------------------------------
alter table public.products add column if not exists may_contain text[] not null default '{}';
alter table public.products add column if not exists cook_min_c numeric(4,1) null;

alter table public.products drop constraint if exists products_may_contain_check;
alter table public.products add constraint products_may_contain_check
  check (public.haccp_valid_allergens(may_contain) and not (may_contain && allergens));
alter table public.products drop constraint if exists products_cook_min_check;
alter table public.products add constraint products_cook_min_check
  check (cook_min_c is null or cook_min_c between 40 and 100);

comment on column public.products.may_contain is
  'Allergènes « peut en contenir » (traces, selon le fournisseur) : 14 codes, sans doublon, disjoint de allergens.';
comment on column public.products.cook_min_c is
  'Température à cœur minimale à la cuisson / remise en température (°C, 40..100), null = sans objet. Ex. porc 63, volaille 74.';
comment on column public.products.shelf_life_opened_hours is
  'Durée de vie après ouverture, en heures ; null = « selon l''étiquette du fabricant » (DLC saisie à la main) ou sans objet.';

-- ---------------------------------------------------------------------------
-- 2. Recettes : préparations maison et plats du menu
-- ---------------------------------------------------------------------------
alter table public.recipes add column if not exists kind text not null default 'preparation';
alter table public.recipes add column if not exists category text null;
alter table public.recipes add column if not exists ingredient_recipe_ids uuid[] not null default '{}';
alter table public.recipes add column if not exists may_contain text[] not null default '{}';
alter table public.recipes alter column shelf_life_hours drop not null;

alter table public.recipes drop constraint if exists recipes_kind_check;
alter table public.recipes add constraint recipes_kind_check check (kind in ('preparation', 'menu_item'));
alter table public.recipes drop constraint if exists recipes_category_check;
alter table public.recipes add constraint recipes_category_check check (category is null or char_length(category) <= 40);
alter table public.recipes drop constraint if exists recipes_sub_recipes_check;
alter table public.recipes add constraint recipes_sub_recipes_check check (
  cardinality(ingredient_recipe_ids) <= 20
  and (cardinality(ingredient_recipe_ids) = 0 or array_ndims(ingredient_recipe_ids) = 1)
  and array_position(ingredient_recipe_ids, null) is null);
alter table public.recipes drop constraint if exists recipes_may_contain_check;
alter table public.recipes add constraint recipes_may_contain_check check (public.haccp_valid_allergens(may_contain));
-- Même nom qu'au lot 4 : préparation → 1..2160 h obligatoire ; plat du menu → null (servi immédiatement).
alter table public.recipes drop constraint if exists recipes_shelf_life_check;
alter table public.recipes add constraint recipes_shelf_life_check check (
  (kind = 'preparation' and shelf_life_hours is not null and shelf_life_hours between 1 and 2160)
  or (kind = 'menu_item' and shelf_life_hours is null));

comment on column public.recipes.kind is
  '''preparation'' = préparation maison (sauce, mélange…, étiquetée) ; ''menu_item'' = plat vendu (tableau des allergènes).';
comment on column public.recipes.category is 'Rubrique du menu (0..40), ex. « Croq''Brioche », « Dessert », « Frites », « Menu enfant ».';
comment on column public.recipes.ingredient_recipe_ids is
  'Sous-recettes (0..20) : préparations (kind = preparation) existantes, sans cycle (trigger, HACCP: recipe_cycle).';
comment on column public.recipes.may_contain is 'Allergènes « peut en contenir » propres à la recette (en plus de ceux des ingrédients).';
comment on column public.recipes.shelf_life_hours is 'Préparation : durée de vie 1..2160 h (obligatoire) ; plat du menu : null.';
comment on table public.recipes is
  'Recettes (lot 4, 4 bis) : préparations maison et plats du menu. Allergènes = union récursive (produits + préparations + extra_allergens) ; '
  'traces = union récursive des may_contain moins les allergènes présents (haccp_recipe_allergens). Jamais supprimées, désactiver avec active = false.';

-- Ingrédients : produits existants ; sous-recettes existantes, de kind 'preparation', sans cycle.
-- Une préparation utilisée comme ingrédient ne peut pas devenir un plat du menu.
create or replace function public.haccp_recipes_check_ingredients()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_missing uuid;
  v_bad     uuid;
  v_user    uuid;
begin
  if tg_op = 'INSERT' or new.ingredient_product_ids is distinct from old.ingredient_product_ids then
    select x into v_missing
      from unnest(new.ingredient_product_ids) x
     where not exists (select 1 from public.products p where p.id = x)
     limit 1;
    if v_missing is not null then
      raise exception 'HACCP: unknown_product — ingrédient % inconnu', v_missing using errcode = 'foreign_key_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.kind is distinct from old.kind and new.kind <> 'preparation' then
    -- Sérialise les modifications du graphe des sous-recettes.
    perform pg_advisory_xact_lock(hashtext('haccp_recipes_graph'));
    select r.id into v_user from public.recipes r
     where r.id <> new.id and new.id = any (r.ingredient_recipe_ids) limit 1;
    if v_user is not null then
      raise exception 'HACCP: recipe_in_use — la préparation % est un ingrédient de %, elle ne peut pas devenir un plat du menu', new.id, v_user
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  if cardinality(new.ingredient_recipe_ids) > 0
     and (tg_op = 'INSERT' or new.ingredient_recipe_ids is distinct from old.ingredient_recipe_ids) then
    perform pg_advisory_xact_lock(hashtext('haccp_recipes_graph'));
    if new.id = any (new.ingredient_recipe_ids) then
      raise exception 'HACCP: recipe_cycle — la recette % se contient elle-même', new.id using errcode = 'check_violation';
    end if;
    select x into v_missing
      from unnest(new.ingredient_recipe_ids) x
     where not exists (select 1 from public.recipes r where r.id = x)
     limit 1;
    if v_missing is not null then
      raise exception 'HACCP: unknown_recipe — sous-recette % inconnue', v_missing using errcode = 'foreign_key_violation';
    end if;
    select x into v_bad
      from unnest(new.ingredient_recipe_ids) x
      join public.recipes r on r.id = x
     where r.kind <> 'preparation'
     limit 1;
    if v_bad is not null then
      raise exception 'HACCP: invalid_sub_recipe — % n''est pas une préparation (un plat du menu ne peut pas être un ingrédient)', v_bad
        using errcode = 'check_violation';
    end if;
    -- Cycle : la recette est-elle atteignable depuis ses sous-recettes (graphe stocké, UNION → terminaison) ?
    if exists (
      with recursive reach(id) as (
        select x from unnest(new.ingredient_recipe_ids) x
        union
        select y
          from reach
          join public.recipes r on r.id = reach.id and r.id <> new.id
          cross join lateral unnest(r.ingredient_recipe_ids) y
      )
      select 1 from reach where reach.id = new.id
    ) then
      raise exception 'HACCP: recipe_cycle — la recette % se contiendrait elle-même par ses sous-recettes', new.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
-- Le trigger existe déjà (lot 4) ; recréé pour l'ordre et la lisibilité.
drop trigger if exists recipes_check_ingredients on public.recipes;
create trigger recipes_check_ingredients before insert or update on public.recipes
  for each row execute function public.haccp_recipes_check_ingredients();
revoke all on function public.haccp_recipes_check_ingredients() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Allergènes calculés d'une recette (union récursive, actifs ou non)
--    allergens   = produits + extra_allergens de la recette et de toutes ses sous-recettes ;
--    may_contain = may_contain des mêmes produits et recettes, moins les allergènes présents.
-- ---------------------------------------------------------------------------
create or replace function public.haccp_recipe_allergens(p_recipe_id uuid)
returns table (allergens text[], may_contain text[])
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with recursive closure(id) as (
    select p_recipe_id
    union
    select x from closure c join public.recipes r on r.id = c.id cross join lateral unnest(r.ingredient_recipe_ids) x
  ),
  recs as (select r.* from public.recipes r join closure c on c.id = r.id),
  prods as (
    select distinct p.* from recs r cross join lateral unnest(r.ingredient_product_ids) pid join public.products p on p.id = pid
  ),
  present as (
    select a from recs, unnest(recs.extra_allergens) a
    union select a from prods, unnest(prods.allergens) a
  ),
  traces as (
    select a from recs, unnest(recs.may_contain) a
    union select a from prods, unnest(prods.may_contain) a
  )
  select coalesce((select array_agg(a order by a) from present), '{}'),
         coalesce((select array_agg(a order by a) from traces where a not in (select a from present)), '{}')
  where exists (select 1 from public.recipes where id = p_recipe_id);
$$;
comment on function public.haccp_recipe_allergens(uuid) is
  'Allergènes (présents) et traces (« peut en contenir », hors présents) d''une recette, calculés récursivement sur produits et sous-recettes. Droits de l''appelant (RLS).';
revoke all on function public.haccp_recipe_allergens(uuid) from public, anon;
grant execute on function public.haccp_recipe_allergens(uuid) to authenticated, service_role;
