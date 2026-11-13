-- Signatory history (09_responsible_party_history.sql): contracts.signatory_name/signatory_email
-- stay a synced cache of "whichever contract_signatories row's start_date is the latest one on or
-- before today" -- this is what contract_missing_attrs() and the reminders in 07 still read.
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
    when insufficient_privilege or check_violation or others then
      execute 'reset role';
      if sqlerrm !~* pattern then raise exception 'FAIL [%]: wrong error: %', label, sqlerrm; end if;
      raise notice 'ok   % (denied: %)', label, left(sqlerrm, 60);
  end;
end $$;

insert into profiles (id, display_name, primary_email) values
  ('00000000-0000-0000-0000-00000000e0a1', 'Dana Owner', 'dana2@sil.org'),
  ('00000000-0000-0000-0000-00000000e0a2', 'Vic Viewer', 'vic@sil.org');
insert into linked_accounts (supabase_user_id, profile_id, email) values
  ('10000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-00000000e0a1', 'dana2@sil.org'),
  ('10000000-0000-0000-0000-00000000e0a2', '00000000-0000-0000-0000-00000000e0a2', 'vic@sil.org');
insert into contract_roles (profile_id, role) values
  ('00000000-0000-0000-0000-00000000e0a1', 'contributor'),
  ('00000000-0000-0000-0000-00000000e0a2', 'viewer');
insert into contract_counterparties (id, name) values ('00000000-0000-0000-0000-00000000e0c1', 'Acme Testing Corp');
insert into contracts (id, title, type_id, counterparty_id, owner_id, department)
values ('00000000-0000-0000-0000-00000000e0d1', 'Long-running MSA', (select id from contract_types limit 1),
        '00000000-0000-0000-0000-00000000e0c1', '00000000-0000-0000-0000-00000000e0a1', 'GTIS');
\set c1 '00000000-0000-0000-0000-00000000e0d1'
\set dana '10000000-0000-0000-0000-00000000e0a1'
\set vic '10000000-0000-0000-0000-00000000e0a2'

select t_eq('new contract starts with no signatory', (select signatory_name from contracts where id = :'c1'), null::text);

-- ── adding history entries syncs the current signatory ──────────────────────
insert into contract_signatories (contract_id, name, email, start_date)
values (:'c1', 'Sheryl Howe', 'sheryl.howe@example.test', date '2020-01-01');
select t_eq('first (only) entry becomes current', (
  select (signatory_name, signatory_email) = ('Sheryl Howe', 'sheryl.howe@example.test') from contracts where id = :'c1'), true);

insert into contract_signatories (contract_id, name, email, start_date)
values (:'c1', 'Jo Signer', 'jo@acme.example', date '2024-01-01');
select t_eq('later-dated entry (still in the past) becomes current', (select signatory_name from contracts where id = :'c1'), 'Jo Signer');
select t_eq('the earlier entry is kept, not overwritten', (select count(*)::int from contract_signatories where contract_id = :'c1'), 2);

-- ── a future-dated entry does not take effect early ──────────────────────────
insert into contract_signatories (contract_id, name, email, start_date)
values (:'c1', 'Future Person', 'future@example.test', date '2099-01-01');
select t_eq('future-dated entry is not current yet', (select signatory_name from contracts where id = :'c1'), 'Jo Signer');
select contract_resync_signatories();
select t_eq('a resync pass does not wrongly promote a future entry', (select signatory_name from contracts where id = :'c1'), 'Jo Signer');
delete from contract_signatories where name = 'Future Person';

-- ── same start_date: the more recently recorded entry wins ──────────────────
insert into contract_signatories (contract_id, name, email, start_date, created_at)
values (:'c1', 'Backfilled Guess', 'guess@example.test', date '2026-06-01', now() - interval '1 hour');
select t_eq('a new, later-dated-than-current entry becomes current', (select signatory_name from contracts where id = :'c1'), 'Backfilled Guess');
insert into contract_signatories (contract_id, name, email, start_date, created_at)
values (:'c1', 'Corrected Name', 'corrected@example.test', date '2026-06-01', now());
select t_eq('same start_date: the more recently recorded entry wins the tie', (select signatory_name from contracts where id = :'c1'), 'Corrected Name');

-- ── missing-data check (07) still reads the synced cache, unchanged ─────────
select t_eq('signatory is not "missing" while a current entry exists',
  (select contract_missing_attrs(contracts) @> array['Signatory name'] from contracts where id = :'c1'), false);

-- ── deleting all history clears the cache, and the missing-data check notices ──
delete from contract_signatories where contract_id = :'c1';
select t_eq('no history left: signatory reverts to null', (select signatory_name from contracts where id = :'c1'), null::text);
select t_eq('signatory is "missing" once there is no current entry',
  (select contract_missing_attrs(contracts) @> array['Signatory name', 'Signatory email'] from contracts where id = :'c1'), true);

-- ── audited like every other contract child table ────────────────────────────
insert into contract_signatories (contract_id, name, start_date) values (:'c1', 'Pat Manager', date '2026-01-01');
select t_eq('history inserts are audited', (
  select count(*)::int from contract_audit_log
  where entity = 'contract_signatories' and action = 'insert' and new_values->>'name' = 'Pat Manager'), 1);

-- ── RLS: only someone who can edit the contract may add a history entry ─────
select t_denied('a viewer cannot add a signatory history entry', :'vic',
  format($q$insert into contract_signatories (contract_id, name, start_date) values (%L, 'Someone Else', current_date)$q$, :'c1'),
  'row-level security');

rollback;
