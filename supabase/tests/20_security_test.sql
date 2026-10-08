-- Row-level-security and integrity tests, run as the `authenticated` role with
-- a simulated Supabase user (request.jwt.claim.sub). Rolled back at the end.
begin;

create function t_ok(label text) returns void language plpgsql as $$ begin raise notice 'ok   %', label; end $$;
create function t_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL [%]: got %, want %', label, got, want; end if;
  raise notice 'ok   %', label;
end $$;
-- Run a statement as a given user (by supabase user id) and require it to FAIL with a message matching pattern.
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
create function t_count(uid uuid, q text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
  execute 'select count(*)::int from (' || q || ') s' into n;
  execute 'reset role';
  return n;
end $$;

-- RLS silently filters UPDATE/DELETE rows instead of raising; require 0 rows affected.
create function t_noeffect(label text, uid uuid, stmt text) returns void language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
  begin
    execute stmt; get diagnostics n = row_count;
  exception when others then
    execute 'reset role'; raise notice 'ok   % (error: %)', label, left(sqlerrm, 50); return;
  end;
  execute 'reset role';
  if n <> 0 then raise exception 'FAIL [%]: % row(s) changed', label, n; end if;
  raise notice 'ok   % (0 rows)', label;
end $$;

-- Run a DML statement as the user and require exactly `want` rows affected.
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

-- ── people ───────────────────────────────────────────────────────────────────
-- profile id (p*) and the Supabase auth user id (u*) are distinct, like production.
insert into profiles (id, display_name, primary_email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Admin Ann',     'admin@sil.org',   'member'),
  ('00000000-0000-0000-0000-0000000000a2', 'Cora Contrib',  'cora@sil.org',    'member'),
  ('00000000-0000-0000-0000-0000000000a3', 'Carl Contrib2', 'carl@sil.org',    'member'),
  ('00000000-0000-0000-0000-0000000000a4', 'Vic Viewer',    'vic@sil.org',     'member'),
  ('00000000-0000-0000-0000-0000000000a5', 'Aud Auditor',   'aud@sil.org',     'member'),
  ('00000000-0000-0000-0000-0000000000a6', 'Nora NoRole',   'nora@sil.org',    'member'),
  ('00000000-0000-0000-0000-0000000000a7', 'Lou LicenseAdmin', 'lou@sil.org',  'admin');   -- license-manager admin!
insert into linked_accounts (supabase_user_id, profile_id, email)
select ('10000000-0000-0000-0000-0000000000' || right(id::text, 2))::uuid, id, primary_email from profiles;

insert into contract_roles (profile_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'contributor'),
  ('00000000-0000-0000-0000-0000000000a3', 'contributor'),
  ('00000000-0000-0000-0000-0000000000a4', 'viewer'),
  ('00000000-0000-0000-0000-0000000000a5', 'auditor');

\set admin   '10000000-0000-0000-0000-0000000000a1'
\set cora    '10000000-0000-0000-0000-0000000000a2'
\set carl    '10000000-0000-0000-0000-0000000000a3'
\set vic     '10000000-0000-0000-0000-0000000000a4'
\set aud     '10000000-0000-0000-0000-0000000000a5'
\set nora    '10000000-0000-0000-0000-0000000000a6'
\set lou     '10000000-0000-0000-0000-0000000000a7'
\set P_cora  '00000000-0000-0000-0000-0000000000a2'
\set P_carl  '00000000-0000-0000-0000-0000000000a3'
\set P_vic   '00000000-0000-0000-0000-0000000000a4'

insert into contract_counterparties (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Acme Ltd');

-- Positive controls: every persona resolves to the identity/role we think it does.
-- Without these, a "denied" test could pass simply because the user was unrecognised.
create function t_myrole(uid uuid) returns text language plpgsql as $$
declare r text; pid uuid;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
  select current_profile_id(), contract_my_role()::text into pid, r;
  execute 'reset role';
  if pid is null then raise exception 'FAIL: user % is not linked to a profile (harness bug)', uid; end if;
  return coalesce(r, 'none');
end $$;
select t_eq('persona: admin',       t_myrole(:'admin'), 'admin');
select t_eq('persona: contributor', t_myrole(:'cora'),  'contributor');
select t_eq('persona: viewer',      t_myrole(:'vic'),   'viewer');
select t_eq('persona: auditor',     t_myrole(:'aud'),   'auditor');
select t_eq('persona: no role',     t_myrole(:'nora'),  'none');
select t_eq('persona: license-manager admin has no contract role', t_myrole(:'lou'), 'none');
select t_eq('license-manager admin is an admin in profiles',
  (select role::text from profiles where id = '00000000-0000-0000-0000-0000000000a7'), 'admin');
select t_eq('admin can read all roles', t_count(:'admin', 'select * from contract_roles'), 5);
select t_eq('contributor reads only their own role row', t_count(:'cora', 'select * from contract_roles'), 1);

-- ── defaults: no role => no access (R-A5), and license-manager admin gets nothing ──
select t_denied('no-role user cannot create a contract', :'nora',
  $q$insert into contracts (title, type_id, counterparty_id, owner_id, department)
     values ('x', (select id from contract_types limit 1), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a6', 'd')$q$);
select t_eq('no-role user sees no counterparties', t_count(:'nora', 'select * from contract_counterparties'), 0);
select t_eq('no-role user gets an empty directory', t_count(:'nora', 'select * from contract_directory()'), 0);
select t_eq('license-manager admin has no contract access (settings hidden)', t_count(:'lou', 'select * from contract_settings'), 0);
select t_eq('license-manager admin sees no types', t_count(:'lou', 'select * from contract_types'), 0);
select t_denied('license-manager admin cannot grant themselves a contract role', :'lou',
  $q$insert into contract_roles (profile_id, role) values ('00000000-0000-0000-0000-0000000000a7', 'admin')$q$);
select t_denied('contributor cannot grant roles', :'cora',
  $q$insert into contract_roles (profile_id, role) values ('00000000-0000-0000-0000-0000000000a2', 'admin')$q$);

-- ── creating contracts (INSERT ... RETURNING must work for the owner) ────────
set local role authenticated;
select set_config('request.jwt.claim.sub', :'cora', true);
create temp table made(id uuid);
grant all on made to authenticated;
with ins as (
    insert into contracts (title, type_id, counterparty_id, owner_id, department)
    values ('Cora standard', (select id from contract_types where form_kind='vendor'),
            '00000000-0000-0000-0000-0000000000c1', :'P_cora', 'Ops')
    returning id)
  insert into made select id from ins;
reset role;
select t_eq('contributor can create (and read back) their own contract', (select count(*)::int from made), 1);
select t_denied('contributor cannot create a contract owned by someone else', :'cora',
  $q$insert into contracts (title, type_id, counterparty_id, owner_id, department)
     values ('x', (select id from contract_types limit 1), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a3', 'd')$q$);
select t_denied('viewer cannot create contracts', :'vic',
  $q$insert into contracts (title, type_id, counterparty_id, owner_id, department)
     values ('x', (select id from contract_types limit 1), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a4', 'd')$q$);
select t_denied('new contracts must start as draft', :'cora',
  $q$insert into contracts (title, type_id, counterparty_id, owner_id, department, status)
     values ('x', (select id from contract_types limit 1), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', 'd', 'active')$q$,
  'draft');

-- A restricted contract and a standard one, both owned by Cora (created directly for setup).
create temp table ids as select (select id from made) as std, gen_random_uuid() as restricted;
insert into contracts (id, title, type_id, counterparty_id, owner_id, department, sensitivity)
select restricted, 'Restricted matter', (select id from contract_types limit 1),
       '00000000-0000-0000-0000-0000000000c1', :'P_cora', 'HR', 'restricted' from ids;
select set_config('t.std', (select std::text from ids), false), set_config('t.res', (select restricted::text from ids), false);

-- ── visibility ───────────────────────────────────────────────────────────────
select t_eq('viewer sees the standard contract',  t_count(:'vic',  $q$select * from contracts where title = 'Cora standard'$q$), 1);
select t_eq('viewer cannot see the restricted contract', t_count(:'vic',  $q$select * from contracts where title = 'Restricted matter'$q$), 0);
select t_eq('other contributor cannot see the restricted contract', t_count(:'carl', $q$select * from contracts where title = 'Restricted matter'$q$), 0);
select t_eq('owner sees their restricted contract', t_count(:'cora', $q$select * from contracts where title = 'Restricted matter'$q$), 1);
select t_eq('admin sees the restricted contract',   t_count(:'admin', $q$select * from contracts where title = 'Restricted matter'$q$), 1);
select t_eq('auditor sees the restricted contract', t_count(:'aud',  $q$select * from contracts where title = 'Restricted matter'$q$), 1);
insert into contract_access (contract_id, profile_id) select restricted, :'P_vic' from ids;
select t_eq('a named user can see the restricted contract', t_count(:'vic', $q$select * from contracts where title = 'Restricted matter'$q$), 1);

-- ── editing ──────────────────────────────────────────────────────────────────
select t_noeffect('viewer cannot edit a contract', :'vic', $q$update contracts set notes = 'hax'$q$);
select t_noeffect('non-owner contributor cannot edit', :'carl', $q$update contracts set notes = 'hax'$q$);
select t_noeffect('auditor cannot edit', :'aud', $q$update contracts set notes = 'hax'$q$);
select t_affects('owner can edit their contract', :'cora', $q$update contracts set notes = 'ok' where title = 'Cora standard'$q$, 1);
select t_noeffect('nobody can delete contracts (no delete policy)', :'admin', $q$delete from contracts$q$);

-- ── activation guard (R-D1) ──────────────────────────────────────────────────
select t_denied('cannot activate without an executed original', :'cora',
  format($q$update contracts set status='active', effective_date=date '2026-01-01', signed_date=date '2025-12-01',
            expiration_date=date '2027-01-01' where id = %L$q$, current_setting('t.std')), 'original');

-- service role registers documents (as the Edge Function does)
create temp table doc as select null::uuid as id;
select t_eq('service role can register an original PDF', (
  select count(*)::int from (select contract_register_document(:'P_cora', current_setting('t.std')::uuid, null, 'original',
    'msa.pdf', 'application/pdf', 1000, repeat('b', 64), 'contracts/x/msa.pdf', 'ver1', 'Executed copy')) r), 1);
do $$ begin
  begin
    perform contract_register_document('00000000-0000-0000-0000-0000000000a2', current_setting('t.std')::uuid, null, 'original',
      'a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 5, repeat('c', 64), 'k', 'v', 'n');
    raise exception 'FAIL [non-PDF original accepted]';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm !~ 'PDF' then raise exception 'FAIL [wrong error for non-PDF original]: %', sqlerrm; end if;
    raise notice 'ok   executed originals must be PDF (R-D8)';
  end;
end $$;
select t_denied('browser users cannot call contract_register_document', :'cora',
  format($q$select contract_register_document(%L, %L, null, 'original', 'a.pdf', 'application/pdf', 5, repeat('c', 64), 'k', 'v', 'n')$q$,
     :'P_cora', current_setting('t.std')), 'permission denied');
select t_denied('browser users cannot call contract_reminders_due', :'admin', $q$select * from contract_reminders_due()$q$, 'permission denied');
do $$ begin
  begin
    perform contract_register_document('00000000-0000-0000-0000-0000000000a4', current_setting('t.std')::uuid, null, 'exhibit',
      'e.pdf', 'application/pdf', 5, repeat('d', 64), 'k2', 'v2', 'n');
    raise exception 'FAIL [viewer registered a document]';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok   a viewer cannot register documents (%)', sqlerrm;
  end;
  begin
    perform contract_register_document('00000000-0000-0000-0000-0000000000a2', current_setting('t.std')::uuid, null, 'original',
      'blank-note.pdf', 'application/pdf', 5, repeat('d', 64), 'k3', 'v3', '   ');
    raise exception 'FAIL [blank change note accepted]';
  exception when check_violation then
    raise notice 'ok   a change note is required (R-D7)';
  end;
end $$;

-- activation now allowed; missing required fields still refused
select t_denied('activation still needs effective/signed dates', :'cora',
  format($q$update contracts set status='active' where id = %L$q$, current_setting('t.std')), 'date');
select t_affects('contract with an original activates', :'cora',
  format($q$update contracts set status='active', effective_date=date '2026-01-01', signed_date=date '2025-12-01',
            expiration_date=date '2027-01-01' where id = %L$q$, current_setting('t.std')), 1);

-- ── versioning + immutability (R-D2, R-D7) ───────────────────────────────────
do $$
declare v_id uuid; v_ver int; v_key uuid;
begin
  select doc_key into v_key from contract_documents where s3_key = 'contracts/x/msa.pdf';
  v_id := contract_register_document('00000000-0000-0000-0000-0000000000a2', current_setting('t.std')::uuid, v_key, 'original',
            'msa-v2.pdf', 'application/pdf', 1200, repeat('e', 64), 'contracts/x/msa-v2.pdf', 'ver2', 'Corrected signature page');
  select version into v_ver from contract_documents where id = v_id;
  if v_ver is distinct from 2 then raise exception 'FAIL [version increments]: got %', v_ver; end if;
  raise notice 'ok   a new version of an original increments the version (R-D7)';
  begin
    perform contract_register_document('00000000-0000-0000-0000-0000000000a2', current_setting('t.std')::uuid, gen_random_uuid(), 'original',
              'x.pdf', 'application/pdf', 5, repeat('e', 64), 'k9', 'v9', 'n');
    raise exception 'FAIL [unknown doc_key accepted]';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok   versioning an unknown document is refused';
  end;
end $$;
select t_eq('both versions are retained', (select count(*)::int from contract_documents where contract_id = current_setting('t.std')::uuid), 2);
do $$ begin
  begin update contract_documents set filename = 'tampered.pdf'; raise exception 'FAIL [document row updated]';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok   document rows cannot be updated (even by superuser)'; end;
  begin delete from contract_documents; raise exception 'FAIL [document row deleted]';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok   document rows cannot be deleted (even by superuser)'; end;
end $$;
select t_eq('viewer can list documents of a contract they can see', t_count(:'vic', 'select * from contract_documents'), 2);
select t_eq('no-role user cannot list documents', t_count(:'nora', 'select * from contract_documents'), 0);
select t_noeffect('browser users cannot delete documents', :'admin', $q$delete from contract_documents$q$);
select t_denied('browser users cannot insert documents directly', :'admin',
  format($q$insert into contract_documents (contract_id, doc_key, version, role, filename, content_type, size_bytes, sha256, s3_key, s3_version_id, change_note)
            values (%L, gen_random_uuid(), 1, 'other', 'f.pdf', 'application/pdf', 1, repeat('f', 64), 'k', 'v', 'n')$q$, current_setting('t.std')));

-- ── decisions ────────────────────────────────────────────────────────────────
select t_denied('cannot record a decision as someone else', :'cora',
  format($q$insert into contract_decisions (contract_id, notice_deadline, decision, decided_by)
            values (%L, date '2026-12-01', 'renew', %L)$q$, current_setting('t.std'), :'P_carl'));
select t_denied('viewer cannot record a decision', :'vic',
  format($q$insert into contract_decisions (contract_id, notice_deadline, decision, decided_by)
            values (%L, date '2026-12-01', 'renew', %L)$q$, current_setting('t.std'), :'P_vic'));
select t_affects('owner can record a decision', :'cora',
  format($q$insert into contract_decisions (contract_id, notice_deadline, decision, decided_by)
            values (%L, date '2026-12-01', 'renew', %L)$q$, current_setting('t.std'), :'P_cora'), 1);

-- ── audit log (append-only; admin/auditor read) ──────────────────────────────
select t_eq('field edits are audited with old and new values', (
  select count(*)::int from contract_audit_log
  where entity = 'contracts' and action = 'update' and old_values ? 'notes' and new_values->>'notes' = 'ok'), 1);
select t_eq('document registration is audited', (select count(*)::int from contract_audit_log where entity = 'contract_documents' and action = 'insert'), 2);
select t_eq('role grants are audited', (select count(*)::int from contract_audit_log where entity = 'contract_roles'), 5);
select t_eq('admin can read the audit log', t_count(:'admin', 'select * from contract_audit_log') > 0, true);
select t_eq('auditor can read the audit log', t_count(:'aud', 'select * from contract_audit_log') > 0, true);
select t_eq('contributor cannot read the audit log', t_count(:'cora', 'select * from contract_audit_log'), 0);
select t_eq('license-manager admin cannot read the audit log', t_count(:'lou', 'select * from contract_audit_log'), 0);
select t_denied('browser users cannot write the audit log', :'admin',
  $q$insert into contract_audit_log (action, entity) values ('x', 'y')$q$, 'permission denied');
do $$ begin
  begin update contract_audit_log set action = 'tampered'; raise exception 'FAIL [audit updated]';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok   audit rows cannot be updated'; end;
  begin delete from contract_audit_log; raise exception 'FAIL [audit deleted]';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok   audit rows cannot be deleted'; end;
end $$;
select contract_log_access(:'P_vic', current_setting('t.std')::uuid, null, 'download');
select t_eq('downloads are logged', (select count(*)::int from contract_audit_log where action = 'download'), 1);

-- ── roles + last-admin guard ─────────────────────────────────────────────────
select t_eq('admin lists only people who have a role (not everyone)', t_count(:'admin', 'select * from contract_admin_users()'), 5);
select t_eq('  ...and the license-manager admin / no-role people are not in it',
  t_count(:'admin', $q$select * from contract_admin_users() where primary_email in ('lou@sil.org', 'nora@sil.org')$q$), 0);
select t_eq('non-admin gets an empty user list', t_count(:'cora', 'select * from contract_admin_users()'), 0);

-- ── people search (03_user_search.sql) ───────────────────────────────────────
-- 100 extra profiles so the old "load everyone" approach would have lost people,
-- plus an underscore address and a look-alike to prove LIKE wildcards are escaped.
insert into profiles (display_name, primary_email)
select 'Bulk Person ' || lpad(g::text, 3, '0'), 'bulk' || lpad(g::text, 3, '0') || '@sil.org' from generate_series(1, 100) g;
insert into profiles (display_name, primary_email) values
  ('Scott Kohler',  'scott_kohler@sil.org'),
  ('Scott Xkohler', 'scottXkohler@sil.org'),
  ('Zed Nobody',    'zed@sil.org');
select t_eq('search finds the one person among 100+ others', t_count(:'admin', $q$select * from contract_search_profiles('scott_kohler')$q$), 1);
select t_eq('"_" does not match the look-alike address',
  t_count(:'admin', $q$select * from contract_search_profiles('scott_kohler') where primary_email like 'scottX%'$q$), 0);
select t_eq('search matches by name', t_count(:'admin', $q$select * from contract_search_profiles('Scott Kohler')$q$), 1);
select t_eq('search is case-insensitive', t_count(:'admin', $q$select * from contract_search_profiles('SCOTT_KOHLER@SIL')$q$), 1);
select t_eq('"%" is a literal, not match-everything', t_count(:'admin', $q$select * from contract_search_profiles('%%')$q$), 0);
select t_eq('queries under 2 characters return nothing', t_count(:'admin', $q$select * from contract_search_profiles('s')$q$), 0);
select t_eq('blank query returns nothing', t_count(:'admin', $q$select * from contract_search_profiles('   ')$q$), 0);
select t_eq('results are capped (default 25)', t_count(:'admin', $q$select * from contract_search_profiles('bulk')$q$), 25);
select t_eq('results are capped (max 50, however much is asked for)', t_count(:'admin', $q$select * from contract_search_profiles('bulk', 1000)$q$), 50);
select t_eq('people who already have a role are not offered again', t_count(:'admin', $q$select * from contract_search_profiles('cora')$q$), 0);
select t_eq('people without a role are found (no-role user)', t_count(:'admin', $q$select * from contract_search_profiles('nora@sil')$q$), 1);
select t_eq('contributor cannot search people', t_count(:'cora', $q$select * from contract_search_profiles('scott')$q$), 0);
select t_eq('license-manager admin cannot search people', t_count(:'lou', $q$select * from contract_search_profiles('scott')$q$), 0);
select t_eq('no-role user cannot search people', t_count(:'nora', $q$select * from contract_search_profiles('scott')$q$), 0);

-- ── directory only carries people the app needs by name ──────────────────────
select t_eq('directory excludes unrelated profiles (not 100+ staff)', t_count(:'cora', 'select * from contract_directory()'), 5);
select t_eq('  ...and an unrelated person is absent', t_count(:'cora', $q$select * from contract_directory() where primary_email = 'zed@sil.org'$q$), 0);
select t_eq('  ...bulk staff are absent', t_count(:'cora', $q$select * from contract_directory() where primary_email like 'bulk%'$q$), 0);
select t_eq('role-holders are in the directory', t_count(:'cora', $q$select * from contract_directory() where primary_email = 'aud@sil.org'$q$), 1);
insert into contracts (title, type_id, counterparty_id, owner_id, department)
select 'Owned by a person with no role', (select id from contract_types limit 1), '00000000-0000-0000-0000-0000000000c1',
       '00000000-0000-0000-0000-0000000000a6', 'Ops';
select t_eq('an owner without a role still resolves to a name', t_count(:'cora', $q$select * from contract_directory() where primary_email = 'nora@sil.org'$q$), 1);
select t_eq('no-role user still gets an empty directory', t_count(:'nora', 'select * from contract_directory()'), 0);
select t_eq('directory empty for license-manager admin', t_count(:'lou', 'select * from contract_directory()'), 0);
select t_denied('cannot demote the last admin', :'admin',
  $q$update contract_roles set role = 'viewer' where profile_id = '00000000-0000-0000-0000-0000000000a1'$q$, 'last contract admin');
select t_denied('cannot delete the last admin', :'admin',
  $q$delete from contract_roles where profile_id = '00000000-0000-0000-0000-0000000000a1'$q$, 'last contract admin');
select t_denied('only admins can lower restricted -> standard', :'cora',
  format($q$update contracts set sensitivity = 'standard' where id = %L$q$, current_setting('t.res')), 'admin');

-- ── reminder log is not writable from the browser ───────────────────────────
select t_denied('browser users cannot write the reminder log', :'admin',
  format($q$insert into contract_reminder_log (contract_id, kind, status) values (%L, 'x', 'sent')$q$, current_setting('t.std')), 'permission denied');

rollback;
