-- New fields from 06_signatory_and_custom_msa.sql: signatory_name (renamed from initial_signer),
-- signatory_email, department_manager_email, contract_length_years round-trip; custom_msa requires
-- an attached "msa" document before activation, same shape as the original-document rule.
begin;
create function t_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL [%]: got %, want %', label, got, want; end if;
  raise notice 'ok   %', label;
end $$;
create function t_denied(label text, uid uuid, stmt text, pattern text default '.') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
  begin
    execute stmt;
    execute 'reset role';
    raise exception 'FAIL [%]: statement was allowed: %', label, stmt;
  exception
    when raise_exception then
      execute 'reset role';
      if sqlerrm like 'FAIL [[]%' then raise; end if;
      if sqlerrm !~* pattern then raise exception 'FAIL [%]: wrong error: %', label, sqlerrm; end if;
      raise notice 'ok   % (denied: %)', label, left(sqlerrm, 60);
    when insufficient_privilege or check_violation or others then
      execute 'reset role';
      if sqlerrm !~* pattern then raise exception 'FAIL [%]: wrong error: %', label, sqlerrm; end if;
      raise notice 'ok   % (denied: %)', label, left(sqlerrm, 60);
  end;
end $$;
create function t_affects(label text, uid uuid, stmt text, want int) returns void language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
  execute stmt; get diagnostics n = row_count;
  execute 'reset role';
  if n <> want then raise exception 'FAIL [%]: % row(s) affected, want %', label, n, want; end if;
  raise notice 'ok   %', label;
end $$;

insert into profiles (id, display_name, primary_email) values ('00000000-0000-0000-0000-0000000000d1', 'Dana Contrib', 'dana@sil.org');
insert into linked_accounts (supabase_user_id, profile_id, email) values ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'dana@sil.org');
insert into contract_roles (profile_id, role) values ('00000000-0000-0000-0000-0000000000d1', 'contributor');
insert into contract_counterparties (id, name) values ('00000000-0000-0000-0000-0000000000c2', 'Acme Software');

\set dana '10000000-0000-0000-0000-0000000000d1'
\set P_dana '00000000-0000-0000-0000-0000000000d1'

-- ── signatory / department-manager-email / contract length round-trip ───────
set local role authenticated;
select set_config('request.jwt.claim.sub', :'dana', true);
create temp table made(id uuid); grant all on made to authenticated;
with ins as (
  insert into contracts (title, type_id, counterparty_id, owner_id, department, department_manager,
      department_manager_email, signatory_name, signatory_email, contract_length_years, custom_msa)
  values ('Acme License', (select id from contract_types limit 1), '00000000-0000-0000-0000-0000000000c2',
      :'P_dana', 'GTIS', 'Pat Manager', 'pat@sil.org', 'Jo Signer', 'jo@acme.example', 3.0, true)
  returning id)
insert into made select id from ins;
reset role;
select set_config('t.c', (select id::text from made), false);

select t_eq('signatory name/email round-trip', (
  select (signatory_name, signatory_email) = ('Jo Signer', 'jo@acme.example') from contracts where id = current_setting('t.c')::uuid), true);
select t_eq('department manager email round-trips alongside the existing name field', (
  select (department_manager, department_manager_email) = ('Pat Manager', 'pat@sil.org') from contracts where id = current_setting('t.c')::uuid), true);
select t_eq('contract length (years) round-trips', (
  select contract_length_years from contracts where id = current_setting('t.c')::uuid), 3.0::numeric);

do $$ begin
  begin
    update contracts set contract_length_years = -1 where id = current_setting('t.c')::uuid;
    raise exception 'FAIL [negative contract length accepted]';
  exception when check_violation then raise notice 'ok   a negative contract length is rejected'; end;
end $$;

-- ── positive control: custom_msa blocks activation without an attached MSA copy ──
-- Attach the executed original first, so the only thing standing between this contract and
-- Active is the missing MSA copy -- otherwise contracts_guard()'s original-on-file check (checked
-- first) fires instead, and this test would be checking the wrong rule.
insert into contract_documents (contract_id, doc_key, version, role, filename, content_type, size_bytes,
                                sha256, s3_key, s3_version_id, change_note)
values (current_setting('t.c')::uuid, gen_random_uuid(), 1, 'original', 'acme-original.pdf', 'application/pdf', 10,
        repeat('b', 64), 'k/orig-' || current_setting('t.c'), 'v1', 'initial');
select t_denied('cannot activate a custom-MSA contract without an attached MSA copy', :'dana',
  format($q$update contracts set status='active', effective_date=date '2026-01-01', signed_date=date '2025-12-01',
            expiration_date=date '2027-01-01' where id = %L$q$, current_setting('t.c')), 'custom MSA');

insert into contract_documents (contract_id, doc_key, version, role, filename, content_type, size_bytes,
                                sha256, s3_key, s3_version_id, change_note)
values (current_setting('t.c')::uuid, gen_random_uuid(), 1, 'msa', 'acme-msa.pdf', 'application/pdf', 10,
        repeat('a', 64), 'k/' || current_setting('t.c'), 'v1', 'negotiated MSA');

select t_affects('activates once the MSA copy is attached', :'dana',
  format($q$update contracts set status='active', effective_date=date '2026-01-01', signed_date=date '2025-12-01',
            expiration_date=date '2027-01-01' where id = %L$q$, current_setting('t.c')), 1);

-- ── toggling custom_msa on for an already-active contract is checked again ───
create temp table made2(id uuid); grant all on made2 to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'dana', true);
with ins as (
  insert into contracts (title, type_id, counterparty_id, owner_id, department)
  values ('Already active, no MSA yet', (select id from contract_types limit 1), '00000000-0000-0000-0000-0000000000c2',
      :'P_dana', 'GTIS')
  returning id)
insert into made2 select id from ins;
reset role;
select set_config('t.c2', (select id::text from made2), false);

insert into contract_documents (contract_id, doc_key, version, role, filename, content_type, size_bytes,
                                sha256, s3_key, s3_version_id, change_note)
values (current_setting('t.c2')::uuid, gen_random_uuid(), 1, 'original', 'y.pdf', 'application/pdf', 10,
        repeat('b', 64), 'k2/' || current_setting('t.c2'), 'v1', 'initial');

select t_affects('activates fine without custom_msa', :'dana',
  format($q$update contracts set status='active', effective_date=date '2026-01-01', signed_date=date '2025-12-01',
            expiration_date=date '2027-01-01' where id = %L$q$, current_setting('t.c2')), 1);

select t_denied('switching custom_msa on for an already-active contract is denied without an attached MSA copy', :'dana',
  format($q$update contracts set custom_msa = true where id = %L$q$, current_setting('t.c2')), 'custom MSA');

insert into contract_documents (contract_id, doc_key, version, role, filename, content_type, size_bytes,
                                sha256, s3_key, s3_version_id, change_note)
values (current_setting('t.c2')::uuid, gen_random_uuid(), 1, 'msa', 'acme-msa-2.pdf', 'application/pdf', 10,
        repeat('b', 64), 'k3/' || current_setting('t.c2'), 'v1', 'negotiated MSA');

select t_affects('switching custom_msa on succeeds once the MSA copy is attached', :'dana',
  format($q$update contracts set custom_msa = true where id = %L$q$, current_setting('t.c2')), 1);

rollback;
