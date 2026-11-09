-- Admin-only "original not on file" exception (05_original_exception.sql): lets a contract
-- activate without an uploaded executed original, given a required reason set by an admin.
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

insert into profiles (id, display_name, primary_email) values
  ('00000000-0000-0000-0000-0000000000b1', 'Admin Ann', 'admin@sil.org'),
  ('00000000-0000-0000-0000-0000000000b2', 'Cora Contrib', 'cora@sil.org');
insert into linked_accounts (supabase_user_id, profile_id, email)
select ('10000000-0000-0000-0000-0000000000' || right(id::text, 2))::uuid, id, primary_email from profiles
where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
insert into contract_roles (profile_id, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'admin'),
  ('00000000-0000-0000-0000-0000000000b2', 'contributor');
insert into contract_counterparties (id, name) values ('00000000-0000-0000-0000-0000000000c9', 'Acme Ltd');

\set admin '10000000-0000-0000-0000-0000000000b1'
\set cora  '10000000-0000-0000-0000-0000000000b2'
\set P_admin '00000000-0000-0000-0000-0000000000b1'
\set P_cora  '00000000-0000-0000-0000-0000000000b2'

-- A draft contract with no uploaded original, owned by Cora.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'cora', true);
create temp table made(id uuid); grant all on made to authenticated;
with ins as (
  insert into contracts (title, type_id, counterparty_id, owner_id, department)
  values ('No-PDF system', (select id from contract_types limit 1), '00000000-0000-0000-0000-0000000000c9', :'P_cora', 'Ops')
  returning id)
insert into made select id from ins;
reset role;
select set_config('t.c', (select id::text from made), false);

-- ── positive control: the original rule still holds without the exception ───
select t_denied('cannot activate without an original and without the exception', :'cora',
  format($q$update contracts set status='active', effective_date=date '2026-01-01', signed_date=date '2025-12-01',
            expiration_date=date '2027-01-01' where id = %L$q$, current_setting('t.c')), 'original');

-- ── only an admin may grant the exception ────────────────────────────────────
select t_denied('a contributor cannot grant the exception themselves', :'cora',
  format($q$update contracts set no_original_exception = true, no_original_reason = 'trust me' where id = %L$q$, current_setting('t.c')),
  'admin');

-- ── a reason is required ─────────────────────────────────────────────────────
select t_denied('an admin cannot set the exception without a reason', :'admin',
  format($q$update contracts set no_original_exception = true where id = %L$q$, current_setting('t.c')));

-- ── admin grants the exception with a reason; the contract can now activate ──
select t_affects('admin grants the exception with a reason', :'admin',
  format($q$update contracts set no_original_exception = true, no_original_reason = 'Migrated from tracking sheet; vendor never returned a signed copy.'
            where id = %L$q$, current_setting('t.c')), 1);
select t_eq('the exception records who granted it and when', (
  select no_original_exception_set_by = :'P_admin'::uuid and no_original_exception_set_at is not null
  from contracts where id = current_setting('t.c')::uuid), true);
select t_affects('a contract with the exception activates without an original', :'cora',
  format($q$update contracts set status='active', effective_date=date '2026-01-01', signed_date=date '2025-12-01',
            expiration_date=date '2027-01-01' where id = %L$q$, current_setting('t.c')), 1);

-- ── a contributor may still edit unrelated fields without touching the exception ──
select t_affects('owner can edit other fields without re-stating the exception', :'cora',
  format($q$update contracts set notes = 'ok' where id = %L$q$, current_setting('t.c')), 1);
select t_eq('the exception is unchanged by that edit', (
  select no_original_exception from contracts where id = current_setting('t.c')::uuid), true);

-- ── only an admin may revoke it, or change the reason ────────────────────────
select t_denied('a contributor cannot revoke the exception', :'cora',
  format($q$update contracts set no_original_exception = false where id = %L$q$, current_setting('t.c')), 'admin');
select t_denied('a contributor cannot edit the reason', :'cora',
  format($q$update contracts set no_original_reason = 'rewritten' where id = %L$q$, current_setting('t.c')), 'admin');
select t_affects('admin revokes the exception', :'admin',
  format($q$update contracts set no_original_exception = false where id = %L$q$, current_setting('t.c')), 1);
select t_eq('revoking clears who/when it was granted', (
  select no_original_exception_set_by is null and no_original_exception_set_at is null
  from contracts where id = current_setting('t.c')::uuid), true);

-- ── audited like any other field (spec §9) ───────────────────────────────────
select t_eq('granting the exception is in the audit log', (
  select count(*)::int from contract_audit_log
  where entity = 'contracts' and action = 'update' and new_values->>'no_original_exception' = 'true'), 1);

rollback;
