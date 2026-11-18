-- =============================================================================
-- HACCP Food Truck — lot 9 : vérification des thermomètres (sondes)
--  1. Nouveau type d'enregistrement `thermometer_check` (miroir de RecordType
--     dans shared/types.ts) : vérification à l'eau glacée (0 °C), à l'eau
--     bouillante ou par comparaison avec un thermomètre de référence. Le contenu
--     est validé par les Edge Functions (shared/validation.ts).
--  2. Réglages : écart admis (défaut ±1 °C) et fréquence de vérification
--     (défaut : au moins tous les 30 jours), modifiables par le gérant.
--  Migration idempotente (rejouable). À appliquer AVANT de redéployer les
--  fonctions (sync-pull lit les nouvelles colonnes de settings).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Types connus (même liste qu'avant + thermometer_check). Le domaine
--    record_type et la contrainte records_type_check appellent cette fonction :
--    on ne fait qu'ajouter un type, les lignes existantes restent valides.
-- ---------------------------------------------------------------------------
create or replace function public.haccp_known_record_type(p text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select p = any (array[
    'system_test', 'temperature_check', 'cooling', 'reheating', 'hot_holding',
    'cooking_check', 'thawing', 'oil_check', 'oil_change', 'reception',
    'label_printed', 'waste', 'cleaning_done', 'checklist_done',
    'corrective_action', 'alert_ack', 'correction', 'thermometer_check'
  ]);
$$;
revoke all on function public.haccp_known_record_type(text) from public, anon;
grant execute on function public.haccp_known_record_type(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Réglages
-- ---------------------------------------------------------------------------
alter table public.settings
  add column if not exists thermometer_tolerance_c numeric(2,1) not null default 1,
  add column if not exists thermometer_check_days integer not null default 30;
do $$ begin
  alter table public.settings add constraint settings_thermometer_ranges
    check (thermometer_tolerance_c between 0.1 and 2 and thermometer_check_days between 1 and 365);
exception when duplicate_object then null; end $$;
comment on column public.settings.thermometer_tolerance_c is
  'Écart admis (°C) entre le thermomètre vérifié et la référence (eau glacée 0 °C…). Défaut 1.';
comment on column public.settings.thermometer_check_days is
  'Chaque thermomètre doit être vérifié au moins tous les N jours. Défaut 30.';
