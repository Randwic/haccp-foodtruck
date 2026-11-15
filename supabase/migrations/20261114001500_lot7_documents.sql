-- =============================================================================
-- HACCP Food Truck — lot 7 (documents, PMS, contrôle sanitaire)
--  1. Table `documents` (DocumentRef de shared/payloads.ts) : référence gérée par
--     le gérant (RLS gérant seul, audit, updated_at forcé, jamais supprimée).
--     PAS transmise par sync-pull : l'app gérant la lit avec supabase-js.
--  2. Bucket privé `documents` : le gérant lit et DÉPOSE (INSERT) ; personne
--     (anon / authenticated) ne modifie ni ne supprime un objet existant.
--  3. documents_expiring(p_days) : documents actifs arrivant à échéance.
--  4. staff_public : vue de l'équipe sans pin_hash / pin_salt (export).
--  5. record_integrity_check() : résumé de verify-integrity dans audit_log.
--  Migration idempotente (rejouable).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Documents
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  category     text not null,
  file_path    text not null,
  mime_type    text not null,
  size_bytes   integer not null,
  issued_on    date null,
  valid_until  date null,
  notes        text null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint documents_title_check     check (char_length(btrim(title)) between 1 and 120 and char_length(title) <= 120),
  constraint documents_category_check  check (category in ('pms', 'training', 'health', 'pest_control', 'maintenance',
                                                           'supplier', 'lab_analysis', 'inspection', 'registration', 'other')),
  constraint documents_file_path_check check (file_path ~ '^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'),
  constraint documents_mime_check      check (
    (mime_type = 'application/pdf' and file_path like '%.pdf') or
    (mime_type = 'image/jpeg'      and file_path like '%.jpg') or
    (mime_type = 'image/png'       and file_path like '%.png') or
    (mime_type = 'image/webp'      and file_path like '%.webp')),
  -- DOCUMENT_MAX_BYTES = 10 000 000
  constraint documents_size_check      check (size_bytes between 1 and 10000000),
  constraint documents_dates_check     check (valid_until is null or issued_on is null or valid_until >= issued_on),
  constraint documents_notes_check     check (notes is null or char_length(notes) <= 500),
  constraint documents_file_path_key   unique (file_path)
);
comment on table public.documents is
  'Documents du contrôle sanitaire (lot 7) : fichier dans le bucket privé documents. Jamais supprimés (active = false) ; '
  'le fichier d''une fiche (file_path, mime_type, size_bytes) ne change jamais : nouvelle version = nouvelle fiche.';

create index if not exists documents_valid_until_idx on public.documents (valid_until) where active and valid_until is not null;

-- Le fichier d'une fiche est figé : l'objet Storage ne peut pas être remplacé, une fiche ne doit
-- donc pas pouvoir pointer après coup vers un autre fichier (preuve de ce qui a été présenté).
create or replace function public.haccp_documents_file_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.file_path is distinct from old.file_path
     or new.mime_type is distinct from old.mime_type
     or new.size_bytes is distinct from old.size_bytes then
    raise exception 'HACCP: document_file_immutable — fichier du document % non modifiable (créer une nouvelle fiche)', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at before insert or update on public.documents
  for each row execute function public.haccp_set_updated_at();
drop trigger if exists documents_file_immutable on public.documents;
create trigger documents_file_immutable before update on public.documents
  for each row execute function public.haccp_documents_file_immutable();
drop trigger if exists documents_audit on public.documents;
create trigger documents_audit after insert or update or delete on public.documents
  for each row execute function public.haccp_audit();
drop trigger if exists documents_no_delete on public.documents;
create trigger documents_no_delete before delete on public.documents
  for each row execute function public.haccp_reference_no_delete();
drop trigger if exists documents_no_truncate on public.documents;
create trigger documents_no_truncate before truncate on public.documents
  for each statement execute function public.haccp_reference_no_delete();

-- Privilèges : gérant seulement (aucune Edge Function n'en a besoin).
revoke all on public.documents from public, anon, authenticated, service_role;
grant select, insert, update on public.documents to authenticated;

alter table public.documents enable row level security;
drop policy if exists manager_read   on public.documents;
drop policy if exists manager_insert on public.documents;
drop policy if exists manager_update on public.documents;
create policy manager_read   on public.documents for select to authenticated using (public.is_manager());
create policy manager_insert on public.documents for insert to authenticated with check (public.is_manager());
create policy manager_update on public.documents for update to authenticated using (public.is_manager()) with check (public.is_manager());

-- ---------------------------------------------------------------------------
-- 2. Bucket privé `documents` (DOCUMENT_BUCKET, DOCUMENT_MAX_BYTES)
--    Lecture et dépôt : le gérant connecté (supabase-js, upsert: false).
--    Modification / suppression / déplacement : personne via l'API (anon, authenticated).
--    Les politiques du bucket `photos` (lot 3) ne sont pas touchées.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10000000, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists haccp_documents_manager_read    on storage.objects;
drop policy if exists haccp_documents_manager_insert  on storage.objects;
drop policy if exists haccp_documents_guard_read      on storage.objects;
drop policy if exists haccp_documents_guard_read_anon on storage.objects;
drop policy if exists haccp_documents_guard_insert    on storage.objects;
drop policy if exists haccp_documents_guard_insert_anon on storage.objects;
drop policy if exists haccp_documents_guard_update    on storage.objects;
drop policy if exists haccp_documents_guard_delete    on storage.objects;

-- Permissives : lecture et dépôt par le gérant (nom `<uuid>.<ext>` à la racine du bucket).
create policy haccp_documents_manager_read on storage.objects
  for select to authenticated using (bucket_id = 'documents' and public.is_manager());
create policy haccp_documents_manager_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and public.is_manager() and name ~ '^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$');

-- Restrictives (ET avec toute autre politique, même ajoutée plus tard).
-- anon n'a pas EXECUTE sur is_manager() : ses politiques n'appellent pas la fonction.
create policy haccp_documents_guard_read on storage.objects
  as restrictive for select to authenticated using (bucket_id <> 'documents' or public.is_manager());
create policy haccp_documents_guard_read_anon on storage.objects
  as restrictive for select to anon using (bucket_id <> 'documents');
create policy haccp_documents_guard_insert on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'documents' or (public.is_manager() and name ~ '^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'));
create policy haccp_documents_guard_insert_anon on storage.objects
  as restrictive for insert to anon with check (bucket_id <> 'documents');
-- UPDATE (upsert, move, métadonnées) : refusé dans les deux sens (vers ou depuis le bucket).
create policy haccp_documents_guard_update on storage.objects
  as restrictive for update to anon, authenticated using (bucket_id <> 'documents') with check (bucket_id <> 'documents');
create policy haccp_documents_guard_delete on storage.objects
  as restrictive for delete to anon, authenticated using (bucket_id <> 'documents');

drop policy if exists haccp_documents_bucket_read on storage.buckets;
create policy haccp_documents_bucket_read on storage.buckets
  for select to authenticated using (id = 'documents' and public.is_manager());

-- ---------------------------------------------------------------------------
-- 3. Documents arrivant à échéance (rappel)
--    Actifs, valid_until renseignée et ≤ aujourd'hui + p_days (déjà échus compris),
--    « aujourd'hui » dans le fuseau de l'établissement (Europe/Paris par défaut).
-- ---------------------------------------------------------------------------
drop function if exists public.documents_expiring(integer);
create function public.documents_expiring(p_days integer default 30)
returns table (
  id uuid, title text, category text, file_path text, mime_type text, size_bytes integer,
  issued_on date, valid_until date, notes text, active boolean, updated_at timestamptz,
  days_left integer
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_today date;
begin
  if not public.is_manager() then
    raise exception 'HACCP: forbidden — réservé au gérant' using errcode = 'insufficient_privilege';
  end if;
  if p_days is null or p_days < 0 or p_days > 3650 then
    raise exception 'HACCP: invalid_days — p_days entre 0 et 3650' using errcode = 'invalid_parameter_value';
  end if;
  select (now() at time zone coalesce(
           (select e.timezone from public.establishment e
             where exists (select 1 from pg_timezone_names z where z.name = e.timezone) limit 1),
           'Europe/Paris'))::date
    into v_today;
  return query
  select d.id, d.title, d.category, d.file_path, d.mime_type, d.size_bytes,
         d.issued_on, d.valid_until, d.notes, d.active, d.updated_at,
         (d.valid_until - v_today)::integer
    from public.documents d
   where d.active and d.valid_until is not null and d.valid_until <= v_today + p_days
   order by d.valid_until, d.title, d.id;
end;
$$;
comment on function public.documents_expiring(integer) is
  'Documents actifs dont valid_until ≤ aujourd''hui + p_days (échus compris, days_left < 0). Gérant seulement.';

-- ---------------------------------------------------------------------------
-- 4. Vue sûre de l'équipe (export contrôle sanitaire) : jamais pin_hash / pin_salt.
--    security_invoker : la RLS de staff s'applique (gérant seul).
-- ---------------------------------------------------------------------------
create or replace view public.staff_public with (security_invoker = true) as
  select s.id, s.display_name, s.role, s.active, s.created_at, s.updated_at
    from public.staff s;
comment on view public.staff_public is 'Équipe sans secrets (pin_hash, pin_salt) : export du registre (lot 7). Gérant seulement (RLS de staff).';
revoke all on public.staff_public from public, anon, authenticated, service_role;
grant select on public.staff_public to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Journal des vérifications d'intégrité (Edge Function verify-integrity)
-- ---------------------------------------------------------------------------
create or replace function public.record_integrity_check(p_user_id uuid, p_summary jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_user_id is null or p_summary is null or jsonb_typeof(p_summary) <> 'object' then
    raise exception 'HACCP: invalid_request — utilisateur et résumé (objet) obligatoires' using errcode = 'invalid_parameter_value';
  end if;
  if pg_column_size(p_summary) > 16384 then
    raise exception 'HACCP: invalid_request — résumé trop volumineux' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.audit_log (actor, table_name, row_id, action, old, new)
  values (p_user_id::text, 'records', null, 'VERIFY_INTEGRITY', null, p_summary);
end;
$$;
comment on function public.record_integrity_check(uuid, jsonb) is
  'Résumé d''une vérification d''intégrité du registre (action VERIFY_INTEGRITY dans audit_log). service_role seulement.';

revoke all on function public.documents_expiring(integer) from public, anon, authenticated, service_role;
revoke all on function public.record_integrity_check(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.haccp_documents_file_immutable() from public, anon, authenticated, service_role;
grant execute on function public.documents_expiring(integer) to authenticated;
grant execute on function public.record_integrity_check(uuid, jsonb) to service_role;
