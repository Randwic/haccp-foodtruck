-- =============================================================================
-- HACCP Food Truck — date d'ouverture (demandée par Cédric le 18/11/2026)
--  settings.opening_date : jour d'ouverture de l'établissement (heure locale). Avant
--  cette date, le moteur d'alertes (alerts-evaluate) est en pause : aucune alerte
--  ouverte, celles déjà ouvertes sont résolues, aucune notification. L'app masque
--  aussi les rappels (relevés, nettoyage, checklists) sur l'écran Aujourd'hui.
--  NULL = déjà ouvert (comportement d'avant). Le registre n'est pas concerné.
--  Migration idempotente (rejouable). À appliquer AVANT de redéployer les fonctions
--  (sync-pull et alerts-evaluate lisent la nouvelle colonne).
-- =============================================================================
alter table public.settings
  add column if not exists opening_date date null;
do $$ begin
  alter table public.settings add constraint settings_opening_date_range
    check (opening_date is null or opening_date between date '2020-01-01' and date '2100-12-31');
exception when duplicate_object then null; end $$;
comment on column public.settings.opening_date is
  'Jour d''ouverture (heure locale). Avant : alertes et rappels en pause. NULL = déjà ouvert.';
