-- =============================================================================
-- HACCP Food Truck — inscription du gérant depuis l'app, une seule fois.
--
-- L'inscription libre de Supabase Auth reste désactivée. L'Edge Function
-- `bootstrap-manager` (service_role) crée l'utilisateur via l'API admin Auth,
-- puis appelle public.bootstrap_manager() qui, dans une transaction sérialisée
-- par un verrou consultatif :
--   * revérifie qu'aucun gérant n'existe (sinon « HACCP: already_bootstrapped ») ;
--   * insère managers, crée la fiche staff (role 'manager', PIN fourni, user_id) ;
--   * renomme l'établissement (ou le crée s'il manque).
-- Deux appels simultanés : le second attend le verrou, voit le gérant créé par
-- le premier et échoue ; la fonction appelante supprime alors son utilisateur.
--
-- Anti-abus : public.bootstrap_attempts conserve les tentatives ÉCHOUÉES
-- (horodatage + raison courte, aucune donnée personnelle). L'Edge Function
-- refuse (429) au-delà de 10 échecs sur 15 minutes. Compteur global (pas par
-- IP : une seule inscription possible dans la vie du projet, et l'IP vue par
-- la fonction n'est pas une donnée fiable) ; les lignes de plus de 24 h sont
-- supprimées à chaque nouvel échec.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Lien compte Supabase ↔ fiche équipier
-- ---------------------------------------------------------------------------
alter table public.staff
  add column user_id uuid null unique references auth.users (id) on delete set null;

comment on column public.staff.user_id is
  'Compte Supabase Auth du membre (gérant) ; null pour les équipiers qui n''ont qu''un PIN.';

-- ---------------------------------------------------------------------------
-- 2. Tentatives d'inscription échouées (compteur anti-abus)
-- ---------------------------------------------------------------------------
create table public.bootstrap_attempts (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  reason  text not null check (reason ~ '^[a-z_]{1,40}$')
);
create index bootstrap_attempts_at_idx on public.bootstrap_attempts (at);

revoke all on table public.bootstrap_attempts from public, anon, authenticated, service_role;
revoke all on sequence public.bootstrap_attempts_id_seq from public, anon, authenticated, service_role;
alter table public.bootstrap_attempts enable row level security;
-- Aucune politique : accès uniquement via les fonctions SECURITY DEFINER ci-dessous.

comment on table public.bootstrap_attempts is
  'Échecs d''inscription du gérant (anti-abus de bootstrap-manager). Aucune donnée personnelle.';

-- Nombre d'échecs dans les p_minutes dernières minutes.
create function public.bootstrap_failure_count(p_minutes integer)
returns integer
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select count(*)::integer
    from public.bootstrap_attempts a
   where a.at > now() - make_interval(mins => greatest(1, least(coalesce(p_minutes, 15), 1440)));
$$;

-- Enregistre un échec et nettoie les lignes de plus de 24 h.
create function public.bootstrap_record_failure(p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
begin
  delete from public.bootstrap_attempts a where a.at < now() - interval '24 hours';
  insert into public.bootstrap_attempts (reason)
  values (case when p_reason ~ '^[a-z_]{1,40}$' then p_reason else 'other' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Inscription du premier (et unique) gérant
-- ---------------------------------------------------------------------------
create function public.bootstrap_manager(
  p_user_id            uuid,
  p_display_name       text,
  p_pin_salt           text,
  p_pin_hash           text,
  p_establishment_name text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_staff_id uuid;
  v_name     text := btrim(coalesce(p_establishment_name, ''));
begin
  if p_user_id is null then
    raise exception 'HACCP: invalid_request — utilisateur manquant' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_display_name, ''))) not between 1 and 60 then
    raise exception 'HACCP: invalid_request — display_name : 1 à 60 caractères' using errcode = 'check_violation';
  end if;
  if length(v_name) not between 1 and 80 then
    raise exception 'HACCP: invalid_request — establishment_name : 1 à 80 caractères' using errcode = 'check_violation';
  end if;

  -- Sérialise toutes les inscriptions : la vérification ci-dessous s'exécute
  -- (nouvel instantané, READ COMMITTED) après la validation d'un appel concurrent.
  perform pg_advisory_xact_lock(hashtextextended('haccp-manager-bootstrap', 0));

  if exists (select 1 from public.managers) then
    raise exception 'HACCP: already_bootstrapped — un gérant existe déjà' using errcode = 'unique_violation';
  end if;

  insert into public.managers (user_id) values (p_user_id);

  insert into public.staff (display_name, role, active, pin_salt, pin_hash, user_id)
  values (btrim(p_display_name), 'manager', true, p_pin_salt, p_pin_hash, p_user_id)
  returning id into v_staff_id;

  update public.establishment set name = v_name where name is distinct from v_name;
  if not exists (select 1 from public.establishment) then
    insert into public.establishment (name) values (v_name);
  end if;

  return v_staff_id;
end;
$$;

comment on function public.bootstrap_manager(uuid, text, text, text, text) is
  'Inscription unique du gérant (Edge Function bootstrap-manager, service_role). Échoue avec HACCP: already_bootstrapped si un gérant existe.';

-- ---------------------------------------------------------------------------
-- 4. Privilèges : service_role uniquement
-- ---------------------------------------------------------------------------
revoke all on function public.bootstrap_failure_count(integer)                   from public, anon, authenticated;
revoke all on function public.bootstrap_record_failure(text)                     from public, anon, authenticated;
revoke all on function public.bootstrap_manager(uuid, text, text, text, text)    from public, anon, authenticated;
grant execute on function public.bootstrap_failure_count(integer)                to service_role;
grant execute on function public.bootstrap_record_failure(text)                  to service_role;
grant execute on function public.bootstrap_manager(uuid, text, text, text, text) to service_role;
