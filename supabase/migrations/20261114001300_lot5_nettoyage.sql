-- =============================================================================
-- HACCP Food Truck — lot 5 (plan de nettoyage, checklists, huiles de friture)
--  1. Tâches du plan de nettoyage et checklists (données de référence, transmises
--     par sync-pull), même régime que suppliers / products / recipes : RLS gérant,
--     service_role en lecture, audit, updated_at imposé, jamais de suppression.
--  2. Données initiales idempotentes (food truck burger / frites), à adapter
--     selon le PMS.
--  Les types `cleaning_done`, `checklist_done`, `oil_check`, `oil_change` figurent
--  déjà dans haccp_known_record_type() ; les réglages d'huile sont posés par …1200.
--  Migration idempotente (rejouable).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Contrôles réutilisables
-- ---------------------------------------------------------------------------
-- Fréquence d'une tâche de nettoyage (CleaningFrequency).
create or replace function public.haccp_valid_cleaning_frequency(p text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$ select p in ('after_service', 'daily', 'weekly', 'monthly') $$;

-- Points d'une checklist (ChecklistItem[]) : tableau de 1 à 40 objets
-- { id: [a-z0-9_-]{1,40} unique, label: texte 1..120 non blanc, required: booléen },
-- sans autre clé.
create or replace function public.haccp_valid_checklist_items(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_ids  text[] := '{}';
  v_id   text;
  v_lbl  text;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return false; end if;
  if jsonb_array_length(p) not between 1 and 40 then return false; end if;
  for v_item in select e from jsonb_array_elements(p) e loop
    if jsonb_typeof(v_item) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(v_item) k where k not in ('id', 'label', 'required')) then return false; end if;
    if jsonb_typeof(v_item -> 'id') is distinct from 'string'
       or jsonb_typeof(v_item -> 'label') is distinct from 'string'
       or jsonb_typeof(v_item -> 'required') is distinct from 'boolean' then
      return false;
    end if;
    v_id  := v_item ->> 'id';
    v_lbl := v_item ->> 'label';
    if v_id !~ '^[a-z0-9_-]{1,40}$' then return false; end if;
    if char_length(v_lbl) > 120 or char_length(btrim(v_lbl)) = 0 then return false; end if;
    if v_id = any (v_ids) then return false; end if;
    v_ids := v_ids || v_id;
  end loop;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Tâches du plan de nettoyage et de désinfection
-- ---------------------------------------------------------------------------
create table if not exists public.cleaning_tasks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  frequency   text not null,
  product     text null,
  method      text null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint cleaning_tasks_name_check      check (public.haccp_valid_ref_name(name)),
  constraint cleaning_tasks_frequency_check check (public.haccp_valid_cleaning_frequency(frequency)),
  constraint cleaning_tasks_product_check   check (product is null or char_length(product) <= 80),
  constraint cleaning_tasks_method_check    check (method is null or char_length(method) <= 500)
);
comment on table public.cleaning_tasks is
  'Plan de nettoyage et désinfection (lot 5). Référencé par records.payload->>''task_id'' (cleaning_done) : jamais supprimé, désactiver avec active = false.';

-- ---------------------------------------------------------------------------
-- 2. Checklists (ouverture, fermeture, nuisibles…)
-- ---------------------------------------------------------------------------
create table if not exists public.checklists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null,
  items       jsonb not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint checklists_name_check  check (public.haccp_valid_ref_name(name)),
  constraint checklists_kind_check  check (kind in ('opening', 'closing', 'pest_control', 'other')),
  constraint checklists_items_check check (public.haccp_valid_checklist_items(items))
);
comment on table public.checklists is
  'Checklists (lot 5). Référencées par records.payload->>''checklist_id'' (checklist_done) : jamais supprimées, désactiver avec active = false. '
  'Les points peuvent changer : une checklist remplie atteste les réponses données, pas la version actuelle des points.';

-- ---------------------------------------------------------------------------
-- Triggers communs : updated_at, audit, aucune suppression (même propriétaire)
-- ---------------------------------------------------------------------------
drop trigger if exists cleaning_tasks_updated_at on public.cleaning_tasks;
create trigger cleaning_tasks_updated_at before insert or update on public.cleaning_tasks
  for each row execute function public.haccp_set_updated_at();
drop trigger if exists cleaning_tasks_audit on public.cleaning_tasks;
create trigger cleaning_tasks_audit after insert or update or delete on public.cleaning_tasks
  for each row execute function public.haccp_audit();
drop trigger if exists cleaning_tasks_no_delete on public.cleaning_tasks;
create trigger cleaning_tasks_no_delete before delete on public.cleaning_tasks
  for each row execute function public.haccp_reference_no_delete();
drop trigger if exists cleaning_tasks_no_truncate on public.cleaning_tasks;
create trigger cleaning_tasks_no_truncate before truncate on public.cleaning_tasks
  for each statement execute function public.haccp_reference_no_delete();

drop trigger if exists checklists_updated_at on public.checklists;
create trigger checklists_updated_at before insert or update on public.checklists
  for each row execute function public.haccp_set_updated_at();
drop trigger if exists checklists_audit on public.checklists;
create trigger checklists_audit after insert or update or delete on public.checklists
  for each row execute function public.haccp_audit();
drop trigger if exists checklists_no_delete on public.checklists;
create trigger checklists_no_delete before delete on public.checklists
  for each row execute function public.haccp_reference_no_delete();
drop trigger if exists checklists_no_truncate on public.checklists;
create trigger checklists_no_truncate before truncate on public.checklists
  for each statement execute function public.haccp_reference_no_delete();

-- Privilèges : gérant (lecture/écriture, filtrée par RLS), Edge Functions (lecture).
revoke all on public.cleaning_tasks, public.checklists from public, anon, authenticated, service_role;
grant select, insert, update on public.cleaning_tasks, public.checklists to authenticated;
grant select on public.cleaning_tasks, public.checklists to service_role;

alter table public.cleaning_tasks enable row level security;
alter table public.checklists     enable row level security;
drop policy if exists manager_read   on public.cleaning_tasks;
drop policy if exists manager_insert on public.cleaning_tasks;
drop policy if exists manager_update on public.cleaning_tasks;
drop policy if exists manager_read   on public.checklists;
drop policy if exists manager_insert on public.checklists;
drop policy if exists manager_update on public.checklists;
create policy manager_read   on public.cleaning_tasks for select to authenticated using (public.is_manager());
create policy manager_insert on public.cleaning_tasks for insert to authenticated with check (public.is_manager());
create policy manager_update on public.cleaning_tasks for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy manager_read   on public.checklists     for select to authenticated using (public.is_manager());
create policy manager_insert on public.checklists     for insert to authenticated with check (public.is_manager());
create policy manager_update on public.checklists     for update to authenticated using (public.is_manager()) with check (public.is_manager());

-- Fonctions utilisées par les contraintes CHECK : évaluées avec les droits de l'appelant.
revoke all on function public.haccp_valid_cleaning_frequency(text) from public, anon;
revoke all on function public.haccp_valid_checklist_items(jsonb)   from public, anon;
grant execute on function public.haccp_valid_cleaning_frequency(text) to authenticated, service_role;
grant execute on function public.haccp_valid_checklist_items(jsonb)   to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Données initiales — food truck burger / frites (idempotent : une fiche
--    modifiée ou désactivée par le gérant n'est jamais écrasée).
--    Produits et modes opératoires génériques : À ADAPTER SELON VOTRE PMS
--    (fiches techniques des produits, dosages, temps de contact).
-- ---------------------------------------------------------------------------
insert into public.cleaning_tasks (id, name, frequency, product, method) values
  ('00000000-0000-4000-8000-000000000501', 'Plans de travail', 'after_service',
   'Détergent-désinfectant contact alimentaire',
   'Débarrasser, nettoyer, appliquer le désinfectant (temps de contact du fabricant), rincer à l''eau potable si exigé, laisser sécher. À adapter selon votre PMS.'),
  ('00000000-0000-4000-8000-000000000502', 'Plancha / grill', 'after_service',
   'Dégraissant plaque de cuisson',
   'Racler à chaud, dégraisser, rincer, essuyer avec un papier à usage unique, huiler légèrement. À adapter selon votre PMS.'),
  ('00000000-0000-4000-8000-000000000503', 'Friteuse — extérieur', 'daily',
   'Dégraissant',
   'Friteuse froide et débranchée : dégraisser carrosserie, commandes et abords, rincer, sécher. À adapter selon votre PMS.'),
  ('00000000-0000-4000-8000-000000000504', 'Friteuse — vidange et nettoyage du bac', 'weekly',
   'Produit de nettoyage pour friteuse',
   'À chaque changement d''huile : vidanger l''huile froide, nettoyer bac, résistances et panier, rincer abondamment, sécher complètement avant remplissage. À adapter selon votre PMS.'),
  ('00000000-0000-4000-8000-000000000505', 'Réfrigérateurs — intérieur', 'weekly',
   'Détergent-désinfectant contact alimentaire',
   'Vider (produits mis au froid ailleurs), retirer clayettes, nettoyer, désinfecter, rincer, sécher, contrôler les joints. À adapter selon votre PMS.'),
  ('00000000-0000-4000-8000-000000000506', 'Congélateur — dégivrage', 'monthly',
   'Détergent-désinfectant contact alimentaire',
   'Transférer les produits dans une enceinte froide, débrancher, dégivrer, nettoyer, désinfecter, sécher, remettre en froid avant rechargement. À adapter selon votre PMS.'),
  ('00000000-0000-4000-8000-000000000507', 'Sols', 'daily',
   'Détergent sols',
   'Balayer, laver, rincer si nécessaire, laisser sécher (sol glissant). À adapter selon votre PMS.'),
  ('00000000-0000-4000-8000-000000000508', 'Poubelles', 'daily',
   'Détergent-désinfectant',
   'Vider, nettoyer et désinfecter les bacs et couvercles, poser un sac neuf. À adapter selon votre PMS.'),
  ('00000000-0000-4000-8000-000000000509', 'Hotte et filtres', 'weekly',
   'Dégraissant',
   'Démonter les filtres, tremper et dégraisser, rincer, sécher ; nettoyer l''intérieur de la hotte. À adapter selon votre PMS.'),
  ('00000000-0000-4000-8000-000000000510', 'Lave-mains', 'daily',
   'Détergent-désinfectant',
   'Nettoyer et désinfecter vasque et commande, réapprovisionner savon et essuie-mains à usage unique. À adapter selon votre PMS.'),
  ('00000000-0000-4000-8000-000000000511', 'Réservoirs d''eau du camion', 'monthly',
   'Désinfectant pour réservoirs d''eau potable',
   'Vidanger, désinfecter selon la notice, rincer abondamment à l''eau potable, remplir. À adapter selon votre PMS.')
on conflict (id) do nothing;

insert into public.checklists (id, name, kind, items) values
  ('00000000-0000-4000-8000-000000000551', 'Ouverture', 'opening', '[
     {"id": "lave_mains",   "label": "Lave-mains approvisionné (savon, papier)",   "required": true},
     {"id": "eau_potable",  "label": "Eau potable disponible",                     "required": true},
     {"id": "temperatures", "label": "Températures des enceintes relevées",        "required": true},
     {"id": "tenue",        "label": "Tenue propre et cheveux attachés",           "required": true},
     {"id": "plans_travail","label": "Plans de travail désinfectés",               "required": true},
     {"id": "nuisibles",    "label": "Pas de nuisibles constatés",                 "required": true}
   ]'::jsonb),
  ('00000000-0000-4000-8000-000000000552', 'Fermeture', 'closing', '[
     {"id": "produits_entames", "label": "Produits entamés filmés et étiquetés", "required": true},
     {"id": "restes",           "label": "Restes jetés ou refroidis",           "required": true},
     {"id": "enceintes",        "label": "Enceintes froides fermées",           "required": true},
     {"id": "nettoyage",        "label": "Nettoyage effectué",                  "required": true},
     {"id": "poubelles",        "label": "Poubelles vidées",                    "required": true},
     {"id": "gaz",              "label": "Gaz coupé",                           "required": true},
     {"id": "friteuses",        "label": "Friteuses couvertes",                 "required": true}
   ]'::jsonb),
  ('00000000-0000-4000-8000-000000000553', 'Contrôle nuisibles', 'pest_control', '[
     {"id": "pieges",     "label": "Pièges vérifiés",                       "required": true},
     {"id": "traces",     "label": "Aucune trace (déjections, emballages rongés…)", "required": true},
     {"id": "ouvertures", "label": "Ouvertures protégées (moustiquaires, joints)",  "required": true}
   ]'::jsonb)
on conflict (id) do nothing;
