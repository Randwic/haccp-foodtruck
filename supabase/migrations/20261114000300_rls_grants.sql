-- =============================================================================
-- HACCP Food Truck — privilèges et Row Level Security
--  * anon           : aucun accès
--  * authenticated  : gérant (is_manager()) = lecture de tout, écriture des
--                     références ; jamais d'écriture dans records / audit_log
--  * service_role   : Edge Functions (contourne RLS) — insertion dans records,
--                     jamais UPDATE / DELETE / TRUNCATE
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. On repart de zéro : Supabase accorde par défaut ALL à anon/authenticated/
--    service_role sur les objets du schéma public.
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from public, anon, authenticated, service_role;
revoke all on all sequences in schema public from public, anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;

-- Objets créés plus tard par le rôle des migrations : rien par défaut.
alter default privileges in schema public revoke all on tables    from public, anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;
-- L'EXECUTE accordé à PUBLIC par défaut est global (non lié à un schéma).
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- 2. Privilèges de table (le filtrage fin est fait par RLS)
-- ---------------------------------------------------------------------------
-- Gérant connecté
grant select on
  public.establishment, public.managers, public.staff, public.devices, public.equipment,
  public.thresholds, public.settings, public.records, public.record_chain_anchors, public.audit_log
  to authenticated;
grant insert, update on public.establishment, public.staff, public.equipment, public.thresholds, public.settings
  to authenticated;
-- Seuils : pas de DELETE (la synchro incrémentale ne verrait pas la suppression) ; mettre à jour à la place.
-- Appareils : le gérant ne peut que renommer / révoquer (l'enrôlement passe par l'Edge Function).
grant update (name, revoked_at) on public.devices to authenticated;

-- Edge Functions (service_role)
grant select on
  public.establishment, public.managers, public.staff, public.devices, public.equipment,
  public.thresholds, public.settings, public.records, public.record_chain_anchors, public.audit_log
  to service_role;
grant insert on public.records to service_role;
grant insert, update on public.establishment, public.staff, public.devices, public.equipment,
  public.thresholds, public.settings
  to service_role;
-- Aucun DELETE / TRUNCATE accordé sur aucune table : désactivation via active = false.

-- ---------------------------------------------------------------------------
-- 3. Fonctions exécutables
-- ---------------------------------------------------------------------------
grant execute on function public.is_manager()             to authenticated, service_role;
grant execute on function public.device_chain_head(uuid)  to authenticated, service_role;
-- Les fonctions de trigger n'ont pas besoin d'EXECUTE pour être déclenchées.

-- ---------------------------------------------------------------------------
-- 4. Row Level Security sur toutes les tables
-- ---------------------------------------------------------------------------
alter table public.establishment        enable row level security;
alter table public.managers             enable row level security;
alter table public.staff                enable row level security;
alter table public.devices              enable row level security;
alter table public.equipment            enable row level security;
alter table public.thresholds           enable row level security;
alter table public.settings             enable row level security;
alter table public.records              enable row level security;
alter table public.record_chain_anchors enable row level security;
alter table public.audit_log            enable row level security;

-- Lecture : gérant uniquement (anon n'a aucun privilège de toute façon).
create policy manager_read on public.establishment        for select to authenticated using (public.is_manager());
create policy manager_read on public.managers             for select to authenticated using (public.is_manager());
create policy manager_read on public.staff                for select to authenticated using (public.is_manager());
create policy manager_read on public.devices              for select to authenticated using (public.is_manager());
create policy manager_read on public.equipment            for select to authenticated using (public.is_manager());
create policy manager_read on public.thresholds           for select to authenticated using (public.is_manager());
create policy manager_read on public.settings             for select to authenticated using (public.is_manager());
create policy manager_read on public.records              for select to authenticated using (public.is_manager());
create policy manager_read on public.record_chain_anchors for select to authenticated using (public.is_manager());
create policy manager_read on public.audit_log            for select to authenticated using (public.is_manager());

-- Écriture des références : gérant uniquement.
create policy manager_insert on public.establishment for insert to authenticated with check (public.is_manager());
create policy manager_update on public.establishment for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy manager_insert on public.staff         for insert to authenticated with check (public.is_manager());
create policy manager_update on public.staff         for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy manager_insert on public.equipment     for insert to authenticated with check (public.is_manager());
create policy manager_update on public.equipment     for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy manager_insert on public.thresholds    for insert to authenticated with check (public.is_manager());
create policy manager_update on public.thresholds    for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy manager_insert on public.settings      for insert to authenticated with check (public.is_manager());
create policy manager_update on public.settings      for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy manager_update on public.devices       for update to authenticated using (public.is_manager()) with check (public.is_manager());

-- records / audit_log / record_chain_anchors / managers : aucune politique d'écriture
-- pour authenticated => toute écriture est refusée par RLS (en plus des privilèges).
