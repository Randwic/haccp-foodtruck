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
