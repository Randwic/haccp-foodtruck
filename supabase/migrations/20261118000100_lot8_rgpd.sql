-- =============================================================================
-- HACCP Food Truck — lot 8 (RGPD) : effacement du nom d'un ancien membre de l'équipe.
--
--  * Le registre HACCP est une obligation légale (traçabilité, règlement 852/2004) :
--    les saisies d'un ancien membre restent, mais son nom est remplacé par un
--    pseudonyme (« Ancien membre A1B2 ») et son PIN rendu inutilisable.
--  * staff.forgotten_at : date de l'effacement. Un membre effacé ne peut plus être
--    réactivé ni renommé (garde haccp_staff_forgotten_guard).
--  * staff_forget(id) : gérant seulement, membre désactivé seulement. Idempotent.
--  * Le journal d'audit (insertion seule) garde l'ancien nom pour la durée de
--    conservation du registre : c'est indiqué dans le registre des traitements.
-- Migration idempotente (rejouable).
-- =============================================================================

alter table public.staff add column if not exists forgotten_at timestamptz null;
comment on column public.staff.forgotten_at is
  'RGPD : date à laquelle le nom a été remplacé par un pseudonyme (membre désactivé, saisies conservées).';

-- Un membre effacé reste désactivé, pseudonymisé, sans PIN utilisable.
create or replace function public.haccp_staff_forgotten_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if old.forgotten_at is not null then
    if new.forgotten_at is null
       or new.active
       or new.display_name is distinct from old.display_name
       or new.pin_hash is distinct from old.pin_hash
       or new.pin_salt is distinct from old.pin_salt
       or new.role is distinct from old.role then
      raise exception 'HACCP: membre effacé (RGPD), il ne peut plus être modifié ni réactivé'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_forgotten_guard on public.staff;
create trigger staff_forgotten_guard before update on public.staff
  for each row execute function public.haccp_staff_forgotten_guard();

create or replace function public.staff_forget(p_staff_id uuid)
returns table (id uuid, display_name text, forgotten_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_staff public.staff%rowtype;
begin
  if not public.is_manager() then
    raise exception 'HACCP: forbidden — réservé au gérant' using errcode = 'insufficient_privilege';
  end if;
  select * into v_staff from public.staff s where s.id = p_staff_id for update;
  if not found then
    raise exception 'HACCP: membre introuvable' using errcode = 'no_data_found';
  end if;
  if v_staff.active then
    raise exception 'HACCP: désactivez d''abord ce membre avant d''effacer son nom' using errcode = 'check_violation';
  end if;
  if v_staff.forgotten_at is null then
    update public.staff s set
      display_name = 'Ancien membre ' || upper(substr(replace(s.id::text, '-', ''), 1, 4)),
      -- PIN inutilisable : sel et empreinte aléatoires (format PBKDF2 respecté).
      pin_salt     = encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'),
      pin_hash     = encode(decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'),
      forgotten_at = now()
    where s.id = p_staff_id;
  end if;
  return query select s.id, s.display_name, s.forgotten_at from public.staff s where s.id = p_staff_id;
end;
$$;

revoke all on function public.staff_forget(uuid) from public, anon, service_role;
grant execute on function public.staff_forget(uuid) to authenticated;
