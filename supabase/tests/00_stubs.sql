-- LOCAL TEST HARNESS ONLY — never run against Supabase.
-- Stands in for the Supabase pieces the contract schema relies on (auth.uid(),
-- the anon/authenticated/service_role roles). The real auth kernel
-- (profiles, linked_accounts, current_profile_id) is loaded from the
-- sil-app-template schema.sql by run.sh, same as production.
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
