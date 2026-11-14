-- =============================================================================
-- Stubs Supabase — UNIQUEMENT pour les tests locaux (jamais appliqué en prod).
-- Reproduit ce que fournit un vrai projet Supabase : rôles, schéma auth,
-- auth.uid(), et les privilèges par défaut (larges) que nos migrations révoquent.
-- =============================================================================
create role anon          nologin noinherit;
create role authenticated nologin noinherit;
create role service_role  nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id     uuid primary key,
  email  text
);
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

grant usage on schema auth   to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Comme Supabase : tout ce qui est créé dans public est accordé à ces rôles.
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Storage (sous-ensemble utile du schéma de Supabase Storage) : buckets, objets, RLS
-- activé, privilèges larges accordés par Supabase, et le trigger qui interdit un DELETE
-- SQL direct dans storage.objects (on doit passer par l'API Storage).
create schema storage;
create table storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  metadata   jsonb,
  unique (bucket_id, name)
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;

create function storage.protect_delete() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') <> 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using errcode = '42501';
  end if;
  return old;
end $$;
create trigger protect_objects_delete before delete on storage.objects
  for each statement execute function storage.protect_delete();
