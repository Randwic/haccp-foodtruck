-- =============================================================================
-- HACCP Food Truck — lot 3 (réception & traçabilité)
--  1. Fournisseurs (donnée de référence, transmise par sync-pull)
--  2. Bucket privé `photos` (Storage) et politiques d'accès
--  3. Purge des photos : désignation en SQL, suppression par l'Edge Function
--     `purge-photos` (API Storage)
--  Les types `reception` et `waste` figurent déjà dans haccp_known_record_type().
--  Migration idempotente (rejouable).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fournisseurs
-- ---------------------------------------------------------------------------
create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text null,
  email       text null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint suppliers_name_check  check (char_length(btrim(name)) between 1 and 80 and char_length(name) <= 80),
  constraint suppliers_phone_check check (phone is null or char_length(btrim(phone)) between 1 and 30),
  constraint suppliers_email_check check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'))
);
comment on table public.suppliers is
  'Fournisseurs (lot 3). Référencés par records.payload->>''supplier_id'' (réceptions) : jamais supprimés, désactiver avec active = false.';

-- Traçabilité amont : réceptions d'un fournisseur.
create index if not exists records_supplier_idx on public.records ((payload ->> 'supplier_id'))
  where type = 'reception' and payload ? 'supplier_id';

drop trigger if exists suppliers_updated_at on public.suppliers;
create trigger suppliers_updated_at before insert or update on public.suppliers
  for each row execute function public.haccp_set_updated_at();

drop trigger if exists suppliers_audit on public.suppliers;
create trigger suppliers_audit after insert or update or delete on public.suppliers
  for each row execute function public.haccp_audit();

-- Pas de suppression physique, pour personne (propriétaire compris) : les réceptions
-- référencent le fournisseur dans leur payload jsonb (pas de clé étrangère possible).
create or replace function public.haccp_suppliers_no_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'HACCP: suppression interdite, fournisseur % (utiliser active = false)', old.id
    using errcode = 'foreign_key_violation';
end;
$$;
drop trigger if exists suppliers_no_delete on public.suppliers;
create trigger suppliers_no_delete before delete on public.suppliers
  for each row execute function public.haccp_suppliers_no_delete();
drop trigger if exists suppliers_no_truncate on public.suppliers;
create trigger suppliers_no_truncate before truncate on public.suppliers
  for each statement execute function public.haccp_suppliers_no_delete();

-- Privilèges : gérant (lecture/écriture, filtrée par RLS), Edge Functions (lecture).
revoke all on public.suppliers from public, anon, authenticated, service_role;
grant select, insert, update on public.suppliers to authenticated;
grant select on public.suppliers to service_role;

alter table public.suppliers enable row level security;
drop policy if exists manager_read   on public.suppliers;
drop policy if exists manager_insert on public.suppliers;
drop policy if exists manager_update on public.suppliers;
create policy manager_read   on public.suppliers for select to authenticated using (public.is_manager());
create policy manager_insert on public.suppliers for insert to authenticated with check (public.is_manager());
create policy manager_update on public.suppliers for update to authenticated using (public.is_manager()) with check (public.is_manager());

-- ---------------------------------------------------------------------------
-- 2. Bucket privé `photos` (PHOTO_BUCKET, PHOTO_MAX_BYTES de shared/payloads.ts)
--    Écriture : uniquement l'Edge Function photo-upload (clé service_role, hors RLS).
--    Lecture : le gérant connecté (URL signées depuis l'app de gestion).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 1000000, array['image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Politiques sur storage.objects (RLS déjà activé par Supabase).
--  * permissive : lecture des photos par le gérant ;
--  * restrictives (ET avec toute autre politique, même ajoutée plus tard) : aucune
--    écriture / suppression pour anon et authenticated, lecture réservée au gérant.
--    Le rôle anon n'a pas EXECUTE sur is_manager() : sa politique n'appelle pas la fonction.
drop policy if exists haccp_photos_manager_read    on storage.objects;
drop policy if exists haccp_photos_guard_read      on storage.objects;
drop policy if exists haccp_photos_guard_read_anon on storage.objects;
drop policy if exists haccp_photos_guard_insert    on storage.objects;
drop policy if exists haccp_photos_guard_update    on storage.objects;
drop policy if exists haccp_photos_guard_delete    on storage.objects;

create policy haccp_photos_manager_read on storage.objects
  for select to authenticated using (bucket_id = 'photos' and public.is_manager());
create policy haccp_photos_guard_read on storage.objects
  as restrictive for select to authenticated using (bucket_id <> 'photos' or public.is_manager());
create policy haccp_photos_guard_read_anon on storage.objects
  as restrictive for select to anon using (bucket_id <> 'photos');
create policy haccp_photos_guard_insert on storage.objects
  as restrictive for insert to anon, authenticated with check (bucket_id <> 'photos');
create policy haccp_photos_guard_update on storage.objects
  as restrictive for update to anon, authenticated using (bucket_id <> 'photos') with check (bucket_id <> 'photos');
create policy haccp_photos_guard_delete on storage.objects
  as restrictive for delete to anon, authenticated using (bucket_id <> 'photos');

-- Le gérant voit la définition du bucket (utile à l'API Storage pour les URL signées).
drop policy if exists haccp_photos_bucket_read on storage.buckets;
create policy haccp_photos_bucket_read on storage.buckets
  for select to authenticated using (id = 'photos' and public.is_manager());

-- ---------------------------------------------------------------------------
-- 3. Purge des photos
--
-- Choix : la suppression ne peut pas se faire proprement en SQL sur Supabase
-- (DELETE direct dans storage.objects bloqué par storage.protect_delete(), et il
-- laisserait le fichier dans le stockage). purge_expired_records() n'est donc pas
-- modifiée ; l'Edge Function `purge-photos` (planifiée chaque jour) :
--   1. appelle photos_to_purge() pour obtenir les chemins à supprimer ;
--   2. les supprime par l'API Storage ;
--   3. journalise le résultat avec record_photo_purge().
--
-- Règle (double condition, prudente) : une photo est supprimée si elle est PLUS
-- VIEILLE que la durée de conservation (created_at < now() - retention_years)
-- ET n'est référencée par AUCUN enregistrement encore présent dans records
-- (quarantaine comprise ; une correction conservée garde aussi son original, donc
-- ses photos). Une photo envoyée sans que son enregistrement n'arrive jamais
-- (orpheline) part elle aussi après la durée de conservation.
-- ---------------------------------------------------------------------------
create or replace function public.photos_to_purge(p_limit integer default 100)
returns table (name text)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_years  integer;
  v_cutoff timestamptz;
begin
  select s.retention_years into v_years from public.settings s where s.id = 1;
  if v_years is null then
    raise exception 'HACCP: purge impossible, paramètres (settings id = 1) absents';
  end if;
  v_cutoff := now() - make_interval(years => v_years);

  return query
  with candidates as (
    select o.name::text as name, o.created_at
      from storage.objects o
     where o.bucket_id = 'photos' and o.created_at < v_cutoff
  ), referenced as (
    -- Toute chaîne du payload au format des chemins de photo (photo_paths, items[].photo_paths,
    -- replacement.* des corrections, photo_path des actions correctives…).
    select distinct j.v #>> '{}' as path
      from public.records r
     cross join lateral jsonb_path_query(
             r.payload,
             'lax $.** ? (@.type() == "string" && @ like_regex "^[0-9a-f-]{36}/[0-9a-f-]{36}\\.webp$")') as j(v)
     where r.payload::text like '%.webp%'
  )
  select c.name
    from candidates c
   where not exists (select 1 from referenced x where x.path = c.name)
   order by c.created_at, c.name
   limit greatest(1, least(coalesce(p_limit, 100), 1000));
end;
$$;
comment on function public.photos_to_purge(integer) is
  'Chemins du bucket photos plus vieux que la durée de conservation et référencés par aucun enregistrement conservé (supprimés ensuite par l''Edge Function purge-photos).';

create or replace function public.record_photo_purge(p_deleted integer, p_failed integer)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  insert into public.audit_log (actor, table_name, row_id, action, old, new)
  values ('system:purge-photos', 'storage.objects', null, 'PURGE_PHOTOS', null,
          jsonb_build_object('deleted', greatest(coalesce(p_deleted, 0), 0), 'failed', greatest(coalesce(p_failed, 0), 0), 'bucket', 'photos'));
$$;

revoke all on function public.photos_to_purge(integer) from public, anon, authenticated;
revoke all on function public.record_photo_purge(integer, integer) from public, anon, authenticated;
revoke all on function public.haccp_suppliers_no_delete() from public, anon, authenticated;
grant execute on function public.photos_to_purge(integer) to service_role;
grant execute on function public.record_photo_purge(integer, integer) to service_role;
