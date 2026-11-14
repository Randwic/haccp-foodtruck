-- =============================================================================
-- HACCP Food Truck — données initiales (idempotent).
-- Pas de membre d'équipe ni de PIN ici : à créer depuis l'écran gérant.
-- =============================================================================

insert into public.establishment (id, name, timezone)
values ('00000000-0000-4000-8000-000000000001', 'Mon Food Truck', 'Europe/Paris')
on conflict do nothing;

insert into public.settings (id, retention_years, auto_lock_minutes, clock_suspect_minutes, email_alerts)
values (1, 3, 5, 5, true)
on conflict (id) do nothing;

insert into public.equipment (id, name, kind) values
  ('00000000-0000-4000-8000-000000000101', 'Frigo 1',          'fridge'),
  ('00000000-0000-4000-8000-000000000102', 'Frigo 2',          'fridge'),
  ('00000000-0000-4000-8000-000000000103', 'Congélateur',      'freezer'),
  ('00000000-0000-4000-8000-000000000104', 'Friteuse – bac 1', 'fryer_vat'),
  ('00000000-0000-4000-8000-000000000105', 'Friteuse – bac 2', 'fryer_vat')
on conflict (id) do nothing;

-- Seuils par défaut — À CONFIRMER SELON LE PMS.
-- Tolérance : durée hors seuil admise avant alerte (capteurs), à confirmer selon le PMS.
insert into public.thresholds (id, equipment_id, check_type, min_c, max_c, tolerance_minutes) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 'temperature_check', null,   4, 20), -- Frigo 1 : max +4 °C (à confirmer selon le PMS)
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000102', 'temperature_check', null,   4, 20), -- Frigo 2 : max +4 °C (à confirmer selon le PMS)
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000103', 'temperature_check', null, -18, 20)  -- Congélateur : max −18 °C (à confirmer selon le PMS)
on conflict do nothing;
