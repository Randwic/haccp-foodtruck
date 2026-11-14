-- =============================================================================
-- HACCP Food Truck — lot 4 (produits, recettes, allergènes, étiquettes)
--  1. Produits et recettes (données de référence, transmises par sync-pull),
--     même régime que les fournisseurs : RLS gérant, service_role en lecture,
--     audit, updated_at imposé, jamais de suppression (désactiver).
--  2. Données initiales idempotentes (food truck burger / frites).
--  3. Index de traçabilité aval et fonction trace_lot() (écran « Rappel produit »).
--  Le type `label_printed` figure déjà dans haccp_known_record_type().
--  Migration idempotente (rejouable).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Contrôles réutilisables
-- ---------------------------------------------------------------------------
-- Allergènes : codes de ALLERGENS (shared/payloads.ts, annexe II du règlement
-- UE 1169/2011), tableau à une dimension, sans null ni doublon.
create or replace function public.haccp_valid_allergens(p text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p is not null
     and (cardinality(p) = 0 or array_ndims(p) = 1)
     and array_position(p, null) is null
     and p <@ array['gluten', 'crustaces', 'oeufs', 'poissons', 'arachides', 'soja', 'lait',
                    'fruits_a_coque', 'celeri', 'moutarde', 'sesame', 'sulfites', 'lupin', 'mollusques']::text[]
     and cardinality(p) = (select count(distinct x) from unnest(p) x);
$$;

-- Mode de conservation (StorageMode).
create or replace function public.haccp_valid_storage(p text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$ select p in ('fridge', 'freezer', 'ambient') $$;

-- Nom affiché : 1..80 caractères, non blanc.
create or replace function public.haccp_valid_ref_name(p text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$ select char_length(btrim(p)) between 1 and 80 and char_length(p) <= 80 $$;

-- ---------------------------------------------------------------------------
-- 1. Produits
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  allergens                text[] not null default '{}',
  storage                  text not null,
  shelf_life_opened_hours  integer null,
  shelf_life_thawed_hours  integer null,
  active                   boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint products_name_check      check (public.haccp_valid_ref_name(name)),
  constraint products_allergens_check check (public.haccp_valid_allergens(allergens)),
  constraint products_storage_check   check (public.haccp_valid_storage(storage)),
  constraint products_opened_check    check (shelf_life_opened_hours is null or shelf_life_opened_hours between 1 and 2160),
  constraint products_thawed_check    check (shelf_life_thawed_hours is null or shelf_life_thawed_hours between 1 and 2160)
);
comment on table public.products is
  'Produits / matières premières (lot 4). Référencés par records.payload->>''product_id'' (étiquettes) : jamais supprimés, désactiver avec active = false.';
comment on column public.products.shelf_life_opened_hours is 'Durée de vie après ouverture, en heures (null = non applicable). À confirmer selon le PMS.';
comment on column public.products.shelf_life_thawed_hours is 'Durée de vie après décongélation, en heures (null = non applicable). À confirmer selon le PMS.';

-- ---------------------------------------------------------------------------
-- 2. Recettes (préparations maison)
-- ---------------------------------------------------------------------------
create table if not exists public.recipes (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  ingredient_product_ids  uuid[] not null default '{}',
  extra_allergens         text[] not null default '{}',
  storage                 text not null,
  shelf_life_hours        integer not null,
  active                  boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint recipes_name_check        check (public.haccp_valid_ref_name(name)),
  constraint recipes_ingredients_check check (
    cardinality(ingredient_product_ids) <= 50
    and (cardinality(ingredient_product_ids) = 0 or array_ndims(ingredient_product_ids) = 1)
    and array_position(ingredient_product_ids, null) is null),
  constraint recipes_allergens_check   check (public.haccp_valid_allergens(extra_allergens)),
  constraint recipes_storage_check     check (public.haccp_valid_storage(storage)),
  constraint recipes_shelf_life_check  check (shelf_life_hours between 1 and 2160)
);
comment on table public.recipes is
  'Recettes / préparations maison (lot 4). Allergènes = union de ceux des ingrédients + extra_allergens. Jamais supprimées, désactiver avec active = false.';

-- Ingrédients : produits existants (actifs ou non). Pas de clé étrangère possible
-- sur un tableau ; les produits n'étant jamais supprimés, le contrôle à l'écriture suffit.
create or replace function public.haccp_recipes_check_ingredients()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_missing uuid;
begin
  if tg_op = 'UPDATE' and new.ingredient_product_ids is not distinct from old.ingredient_product_ids then
    return new;
  end if;
  select x into v_missing
    from unnest(new.ingredient_product_ids) x
   where not exists (select 1 from public.products p where p.id = x)
   limit 1;
  if v_missing is not null then
    raise exception 'HACCP: unknown_product — ingrédient % inconnu', v_missing using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers communs : updated_at, audit, aucune suppression (même propriétaire)
-- ---------------------------------------------------------------------------
create or replace function public.haccp_reference_no_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_level = 'ROW' then
    raise exception 'HACCP: suppression interdite, % % (utiliser active = false)', tg_table_name, old.id
      using errcode = 'foreign_key_violation';
  end if;
  raise exception 'HACCP: suppression interdite, % (utiliser active = false)', tg_table_name
    using errcode = 'foreign_key_violation';
end;
$$;

drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at before insert or update on public.products
  for each row execute function public.haccp_set_updated_at();
drop trigger if exists products_audit on public.products;
create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.haccp_audit();
drop trigger if exists products_no_delete on public.products;
create trigger products_no_delete before delete on public.products
  for each row execute function public.haccp_reference_no_delete();
drop trigger if exists products_no_truncate on public.products;
create trigger products_no_truncate before truncate on public.products
  for each statement execute function public.haccp_reference_no_delete();

drop trigger if exists recipes_updated_at on public.recipes;
create trigger recipes_updated_at before insert or update on public.recipes
  for each row execute function public.haccp_set_updated_at();
drop trigger if exists recipes_check_ingredients on public.recipes;
create trigger recipes_check_ingredients before insert or update on public.recipes
  for each row execute function public.haccp_recipes_check_ingredients();
drop trigger if exists recipes_audit on public.recipes;
create trigger recipes_audit after insert or update or delete on public.recipes
  for each row execute function public.haccp_audit();
drop trigger if exists recipes_no_delete on public.recipes;
create trigger recipes_no_delete before delete on public.recipes
  for each row execute function public.haccp_reference_no_delete();
drop trigger if exists recipes_no_truncate on public.recipes;
create trigger recipes_no_truncate before truncate on public.recipes
  for each statement execute function public.haccp_reference_no_delete();

-- Privilèges : gérant (lecture/écriture, filtrée par RLS), Edge Functions (lecture).
revoke all on public.products, public.recipes from public, anon, authenticated, service_role;
grant select, insert, update on public.products, public.recipes to authenticated;
grant select on public.products, public.recipes to service_role;

alter table public.products enable row level security;
alter table public.recipes  enable row level security;
drop policy if exists manager_read   on public.products;
drop policy if exists manager_insert on public.products;
drop policy if exists manager_update on public.products;
drop policy if exists manager_read   on public.recipes;
drop policy if exists manager_insert on public.recipes;
drop policy if exists manager_update on public.recipes;
create policy manager_read   on public.products for select to authenticated using (public.is_manager());
create policy manager_insert on public.products for insert to authenticated with check (public.is_manager());
create policy manager_update on public.products for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy manager_read   on public.recipes  for select to authenticated using (public.is_manager());
create policy manager_insert on public.recipes  for insert to authenticated with check (public.is_manager());
create policy manager_update on public.recipes  for update to authenticated using (public.is_manager()) with check (public.is_manager());

-- ---------------------------------------------------------------------------
-- 3. Données initiales — food truck burger / frites (idempotent : un produit
--    modifié ou désactivé par le gérant n'est jamais écrasé).
--    Allergènes indicatifs : À VÉRIFIER sur les fiches techniques des fournisseurs.
--    Durées de vie prudentes : À CONFIRMER SELON LE PMS.
-- ---------------------------------------------------------------------------
insert into public.products (id, name, allergens, storage, shelf_life_opened_hours, shelf_life_thawed_hours) values
  -- Pain burger : 48 h après ouverture du sachet ; 48 h après décongélation s'il est livré surgelé (à confirmer selon le PMS)
  ('00000000-0000-4000-8000-000000000401', 'Pain burger',             '{gluten,sesame}', 'ambient', 48,  48),
  -- Cheddar en tranches : 72 h après ouverture (à confirmer selon le PMS)
  ('00000000-0000-4000-8000-000000000402', 'Cheddar en tranches',     '{lait}',          'fridge',  72,  null),
  -- Steak haché surgelé : cuisson directe ; 24 h après décongélation au froid, jamais recongelé (à confirmer selon le PMS)
  ('00000000-0000-4000-8000-000000000403', 'Steak haché surgelé',     '{}',              'freezer', null, 24),
  -- Sauce burger (contient œufs, moutarde) : 72 h au froid après ouverture (à confirmer selon le PMS)
  ('00000000-0000-4000-8000-000000000404', 'Sauce burger',            '{oeufs,moutarde}', 'fridge', 72,  null),
  -- Frites surgelées : cuisson directe sans décongélation ; sachet entamé refermé au congélateur, 7 jours (à confirmer selon le PMS)
  ('00000000-0000-4000-8000-000000000405', 'Frites surgelées',        '{}',              'freezer', 168, null),
  -- Bacon en tranches : 72 h après ouverture (à confirmer selon le PMS)
  ('00000000-0000-4000-8000-000000000406', 'Bacon en tranches',       '{}',              'fridge',  72,  null),
  -- Salade lavée prête à l'emploi : 24 h après ouverture (à confirmer selon le PMS)
  ('00000000-0000-4000-8000-000000000407', 'Salade iceberg (sachet)', '{}',              'fridge',  24,  null),
  -- Cornichons (bocal) : 7 jours au froid après ouverture ; sulfites selon la recette du fabricant (à confirmer selon le PMS)
  ('00000000-0000-4000-8000-000000000408', 'Cornichons',              '{moutarde}',      'ambient', 168, null)
on conflict (id) do nothing;

-- Recette d'exemple : sauce cheddar maison (roux à la farine de blé → gluten en plus du lait du cheddar).
-- Durée de vie 72 h au froid après fabrication (à confirmer selon le PMS).
insert into public.recipes (id, name, ingredient_product_ids, extra_allergens, storage, shelf_life_hours) values
  ('00000000-0000-4000-8000-000000000451', 'Sauce cheddar maison', '{00000000-0000-4000-8000-000000000402}', '{gluten}', 'fridge', 72)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Traçabilité aval
-- ---------------------------------------------------------------------------
-- Normalisation d'un n° de lot : minuscules, sans aucun espace (« L 2611-a » = « l2611-A »).
create or replace function public.haccp_norm_lot(p text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$ select nullif(regexp_replace(lower(p), '[[:space:]]+', '', 'g'), '') $$;

-- Lots (normalisés) cités par un payload : `lot` (waste, label_printed), `items[].lot`
-- (reception), et les mêmes dans `replacement` (corrections). Mode lax + filtres de type :
-- jamais d'erreur, même sur un payload mis en quarantaine (sinon l'insertion échouerait).
-- Les valeurs de plus de 100 caractères sont ignorées (taille d'entrée d'index ; le contrat
-- limite `lot` à 40).
create or replace function public.haccp_record_lots(p jsonb)
returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select coalesce(array_agg(distinct l order by l), '{}')
    from (
      select public.haccp_norm_lot(v #>> '{}') as l
        from jsonb_path_query(p,
               'lax $.lot ? (@.type() == "string")') v
      union all
      select public.haccp_norm_lot(v #>> '{}')
        from jsonb_path_query(p, 'lax $.items[*].lot ? (@.type() == "string")') v
      union all
      select public.haccp_norm_lot(v #>> '{}')
        from jsonb_path_query(p, 'lax $.replacement.lot ? (@.type() == "string")') v
      union all
      select public.haccp_norm_lot(v #>> '{}')
        from jsonb_path_query(p, 'lax $.replacement.items[*].lot ? (@.type() == "string")') v
    ) s
   where l is not null and char_length(l) <= 100;
$$;

-- Réceptions / pertes / étiquettes (et leurs corrections) contenant un lot donné.
create index if not exists records_lots_idx on public.records using gin (public.haccp_record_lots(payload))
  where type in ('reception', 'waste', 'label_printed', 'correction');

-- Étiquettes dont source_record_ids contient une réception donnée :
--   where type = 'label_printed' and payload -> 'source_record_ids' @> jsonb_build_array('<uuid>')
create index if not exists records_label_sources_idx on public.records
  using gin ((payload -> 'source_record_ids') jsonb_path_ops)
  where type = 'label_printed';
-- Idem pour les corrections d'étiquettes (rares, mais le remplacement fait foi).
create index if not exists records_correction_sources_idx on public.records
  using gin ((payload -> 'replacement' -> 'source_record_ids') jsonb_path_ops)
  where type = 'correction';
-- Pertes liées à une réception / une étiquette.
create index if not exists records_waste_related_idx on public.records ((payload ->> 'related_record_id'))
  where type = 'waste';

-- ---------------------------------------------------------------------------
-- trace_lot(lot) : écran « Rappel produit » (gérant seulement).
-- Renvoie :
--   * les réceptions dont une ligne porte ce lot (comparaison sans casse ni espaces) ;
--   * les étiquettes portant ce lot, ou dont source_record_ids cite une de ces réceptions ;
--   * les pertes portant ce lot, ou liées (related_record_id) à une de ces réceptions / étiquettes.
-- Les corrections sont incluses (record_type = 'correction', kind = type d'origine,
-- correspondance sur le remplacement) ; `corrected` signale un enregistrement corrigé depuis.
-- Les enregistrements en quarantaine sont inclus et signalés (quarantine_reason) : pour un
-- rappel, mieux vaut trop que pas assez.
-- matched_by : 'lot' | 'source_record' (étiquette) | 'related_record' (perte).
-- ---------------------------------------------------------------------------
drop function if exists public.trace_lot(text);
create function public.trace_lot(p_lot text)
returns table (
  kind              text,
  matched_by        text,
  record_id         uuid,
  record_type       text,
  supersedes_id     uuid,
  corrected         boolean,
  quarantine_reason text,
  device_time       timestamptz,
  server_time       timestamptz,
  author_id         uuid,
  device_id         uuid,
  payload           jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
declare
  v_lot text := public.haccp_norm_lot(p_lot);
begin
  if not public.is_manager() then
    raise exception 'HACCP: forbidden — réservé au gérant' using errcode = 'insufficient_privilege';
  end if;
  if v_lot is null or char_length(v_lot) > 100 then
    raise exception 'HACCP: invalid_lot — n° de lot vide ou trop long' using errcode = 'invalid_parameter_value';
  end if;

  return query
  with recursive
  -- Type d'origine de chaque correction (correction → … → original). Les corrections sont rares.
  walk as (
    select c.id, c.supersedes_id as cur, c.type::text as t, 0 as depth
      from public.records c where c.type = 'correction'
    union all
    select w.id, o.supersedes_id, o.type::text, w.depth + 1
      from walk w join public.records o on o.id = w.cur
     where w.t = 'correction' and w.depth < 50
  ),
  origin as (
    select distinct on (w.id) w.id, w.t from walk w where w.t <> 'correction' order by w.id, w.depth desc
  ),
  -- 1. Tout ce qui porte le lot (index records_lots_idx).
  by_lot as (
    select r.id, coalesce(o.t, r.type::text) as k
      from public.records r left join origin o on o.id = r.id
     where r.type in ('reception', 'waste', 'label_printed', 'correction')
       and public.haccp_record_lots(r.payload) @> array[v_lot]
  ),
  -- Réceptions trouvées + toute leur chaîne de corrections (une étiquette peut citer l'une ou l'autre).
  rec_up as (
    select l.id from by_lot l where l.k = 'reception'
    union
    select r.supersedes_id from rec_up u join public.records r on r.id = u.id where r.supersedes_id is not null
  ),
  rec_ids as (
    select u.id from rec_up u
    union
    select r.id from rec_ids x join public.records r on r.supersedes_id = x.id
  ),
  -- 2. Étiquettes citant une de ces réceptions (index records_label_sources_idx / records_correction_sources_idx).
  labels_by_src as (
    select r.id, 'label_printed'::text as k
      from rec_ids x
      join public.records r
        on r.type = 'label_printed' and (r.payload -> 'source_record_ids') @> jsonb_build_array(x.id::text)
    union
    select r.id, 'label_printed'
      from rec_ids x
      join public.records r
        on r.type = 'correction' and (r.payload -> 'replacement' -> 'source_record_ids') @> jsonb_build_array(x.id::text)
      join origin o on o.id = r.id and o.t = 'label_printed'
  ),
  linked_ids as (
    select x.id from rec_ids x
    union select l.id from labels_by_src l
    union select l.id from by_lot l where l.k = 'label_printed'
  ),
  -- 3. Pertes liées à une réception ou une étiquette (index records_waste_related_idx).
  waste_by_rel as (
    select r.id, 'waste'::text as k
      from linked_ids x
      join public.records r on r.type = 'waste' and (r.payload ->> 'related_record_id') = x.id::text
    union
    select r.id, 'waste'
      from linked_ids x
      join public.records r
        on r.type = 'correction' and (r.payload -> 'replacement' ->> 'related_record_id') = x.id::text
      join origin o on o.id = r.id and o.t = 'waste'
  ),
  hits as (
    select h.id, h.k, 'lot'::text as m, 1 as prio from by_lot h
    union all
    select h.id, h.k, 'source_record', 2 from labels_by_src h
    union all
    select h.id, h.k, 'related_record', 3 from waste_by_rel h
  ),
  best as (
    select distinct on (h.id) h.id, h.k, h.m from hits h order by h.id, h.prio
  )
  select b.k, b.m, r.id, r.type::text, r.supersedes_id,
         exists (select 1 from public.records c where c.supersedes_id = r.id),
         r.quarantine_reason, r.device_time, r.server_time, r.author_id, r.device_id, r.payload
    from best b join public.records r on r.id = b.id
   order by case b.k when 'reception' then 1 when 'label_printed' then 2 when 'waste' then 3 else 4 end,
            r.device_time, r.id;
end;
$$;
comment on function public.trace_lot(text) is
  'Rappel produit (gérant) : réceptions contenant le lot (sans casse ni espaces), étiquettes et pertes liées (par lot, source_record_ids ou related_record_id).';

revoke all on function public.trace_lot(text) from public, anon, authenticated, service_role;
grant execute on function public.trace_lot(text) to authenticated;

revoke all on function public.haccp_recipes_check_ingredients() from public, anon, authenticated;
revoke all on function public.haccp_reference_no_delete() from public, anon, authenticated;

-- Fonctions utilisées par les contraintes CHECK et l'index de lots : évaluées avec les droits
-- de l'appelant (gérant via REST, Edge Functions à l'insertion dans records).
revoke all on function public.haccp_valid_allergens(text[]) from public, anon;
revoke all on function public.haccp_valid_storage(text)     from public, anon;
revoke all on function public.haccp_valid_ref_name(text)    from public, anon;
revoke all on function public.haccp_norm_lot(text)          from public, anon;
revoke all on function public.haccp_record_lots(jsonb)      from public, anon;
grant execute on function public.haccp_valid_allergens(text[]) to authenticated, service_role;
grant execute on function public.haccp_valid_storage(text)     to authenticated, service_role;
grant execute on function public.haccp_valid_ref_name(text)    to authenticated, service_role;
grant execute on function public.haccp_norm_lot(text)          to authenticated, service_role;
grant execute on function public.haccp_record_lots(jsonb)      to authenticated, service_role;
