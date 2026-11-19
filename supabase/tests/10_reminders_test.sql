-- Unit tests for contract_reminders_due() and the notice-deadline computation.
-- Runs inside a transaction that is rolled back. Dates are fixed so results are
-- deterministic. Reference: expiration 2026-09-01, notice 60 days
--   => notice deadline 2026-07-03; leads 120/60/14 => 2026-03-05, 2026-05-04, 2026-06-19.
begin;

create function t_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL [%]: got %, want %', label, got, want;
  end if;
  raise notice 'ok   %', label;
end $$;

insert into profiles (id, display_name, primary_email) values
  ('00000000-0000-0000-0000-0000000000a1', 'Olive Owner',  'owner@sil.org'),
  ('00000000-0000-0000-0000-0000000000a2', 'Barry Backup', 'backup@sil.org');

insert into contract_counterparties (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Acme Ltd');

-- helper: build an ACTIVE contract (needs an original on file to activate)
create function t_contract(p_id uuid, p_exp date, p_notice int, p_backup uuid default null,
                           p_evergreen boolean default false, p_reminders boolean default true)
returns void language plpgsql as $$
declare v_type uuid := (select id from contract_types where form_kind = 'vendor' limit 1);
begin
  insert into contracts (id, title, type_id, counterparty_id, owner_id, backup_owner_id, department,
                         effective_date, signed_date, expiration_date, evergreen, notice_period_days,
                         reminders_enabled, created_at)
  values (p_id, 'Contract ' || left(p_id::text, 4), v_type, '00000000-0000-0000-0000-0000000000c1',
          '00000000-0000-0000-0000-0000000000a1', p_backup, 'Ops',
          date '2026-01-01', date '2025-12-15', p_exp, p_evergreen, p_notice, p_reminders,
          -- Pinned to the far future so the missing-data reminders (which recur from created_at) never
          -- co-fire here; they are covered by 60_notification_requirements_test.sql. Without this the
          -- expectations depended on the real date the suite was run on.
          timestamptz '2099-01-01');
  insert into contract_documents (contract_id, doc_key, version, role, filename, content_type, size_bytes,
                                  sha256, s3_key, s3_version_id, change_note)
  values (p_id, gen_random_uuid(), 1, 'original', 'x.pdf', 'application/pdf', 10,
          repeat('a', 64), 'k/' || p_id, 'v1', 'initial');
  update contracts set status = 'active' where id = p_id;
end $$;

\set c1 '00000000-0000-0000-0000-0000000000d1'
select t_contract(:'c1', date '2026-09-01', 60, '00000000-0000-0000-0000-0000000000a2');

-- computed notice deadline
select t_eq('notice deadline = expiry - notice days',
  (select notice_deadline from contracts where id = :'c1'), date '2026-07-03');

create function t_kinds(p_today date) returns text language sql stable as $$
  select coalesce(string_agg(kind, ',' order by kind), '') from contract_reminders_due(p_today)
$$;

-- before the 120-day mark: nothing
select t_eq('124 days out: nothing', t_kinds(date '2026-03-01'), '');
-- exactly on each lead
select t_eq('120 days out: planning', t_kinds(date '2026-03-05'), 'notice_120');
select t_eq('119 days out: still 120 tier (not yet due again)', t_kinds(date '2026-03-06'), 'notice_120');
-- From 07_notification_requirements.sql on, contract_reminders_due() also returns the new
-- termination_notice_*/contract_end_notice_* kinds for the SAME contract/dates (same lead-tier
-- catch-up logic as the old notice_* system, just keyed off two different anchors — the notice
-- deadline and the expiration date). Expected strings below include them where the math says they
-- legitimately co-occur; see 60_notification_requirements_test.sql for that logic in isolation.
select t_eq('60 days out: decision', t_kinds(date '2026-05-04'), 'notice_60,termination_notice_90');
select t_eq('14 days out: final', t_kinds(date '2026-06-19'), 'contract_end_notice_90,notice_14,termination_notice_30');
select t_eq('8 days out: final only', t_kinds(date '2026-06-25'), 'contract_end_notice_90,notice_14,termination_notice_30');
select t_eq('7 days out: final + escalation', t_kinds(date '2026-06-26'), 'contract_end_notice_90,escalation,notice_14,termination_notice_30');
select t_eq('on the deadline day: still actionable', t_kinds(date '2026-07-03'), 'contract_end_notice_90,escalation,notice_14,termination_notice_30');
select t_eq('day after the deadline: passed', t_kinds(date '2026-07-04'), 'contract_end_notice_90,passed_deadline');

-- late entry: 32 days out must produce ONE catch-up notice, not 120 + 60
select t_eq('late entry sends only the latest reached tier', t_kinds(date '2026-06-01'), 'notice_60,termination_notice_90');

-- sent marker suppresses; failed does not
insert into contract_reminder_log (contract_id, kind, notice_deadline, recipients, status, error)
values (:'c1', 'notice_60', date '2026-07-03', '{owner@sil.org}', 'failed', 'resend 500');
select t_eq('failed send is retried next run', t_kinds(date '2026-06-01'), 'notice_60,termination_notice_90');
insert into contract_reminder_log (contract_id, kind, notice_deadline, recipients, status)
values (:'c1', 'notice_60', date '2026-07-03', '{owner@sil.org}', 'sent');
select t_eq('sent send is not repeated', t_kinds(date '2026-06-01'), 'termination_notice_90');
select t_eq('next tier still fires after earlier tier sent', t_kinds(date '2026-06-19'), 'contract_end_notice_90,notice_14,termination_notice_30');

-- recipients
select t_eq('notice goes to owner + backup',
  (select to_emails from contract_reminders_due(date '2026-06-19') where kind = 'notice_14'),
  array['owner@sil.org', 'backup@sil.org']);
select t_eq('escalation goes to backup only when no fallback set',
  (select to_emails from contract_reminders_due(date '2026-06-26') where kind = 'escalation'),
  array['backup@sil.org']);
update contract_settings set value = to_jsonb('escalations@sil.org'::text) where key = 'escalation_fallback_email';
select t_eq('escalation goes to backup + fallback contact',
  (select to_emails from contract_reminders_due(date '2026-06-26') where kind = 'escalation'),
  array['backup@sil.org', 'escalations@sil.org']);
update contract_settings set value = 'null' where key = 'escalation_fallback_email';

-- decision stops the cycle (R-R5) — and a new cycle starts when the dates change (R-R7)
insert into contract_decisions (contract_id, notice_deadline, decision, rationale)
values (:'c1', date '2026-07-03', 'renew', 'Good vendor');
select t_eq('decision suppresses notice + escalation', t_kinds(date '2026-06-26'), '');
select t_eq('decision suppresses passed-deadline flag', t_kinds(date '2026-07-04'), '');
update contracts set expiration_date = date '2027-09-01' where id = :'c1';
select t_eq('renewal moves the deadline', (select notice_deadline from contracts where id = :'c1'), date '2027-07-03');
select t_eq('new cycle: nothing yet', t_kinds(date '2026-07-04'), '');
select t_eq('new cycle: reminders resume', t_kinds(date '2027-03-05'), 'notice_120');

-- escalation with no backup and no fallback must not vanish: goes to owner
\set c2 '00000000-0000-0000-0000-0000000000d2'
select t_contract(:'c2', date '2026-09-01', 60);
select t_eq('escalation falls back to owner when nobody else exists',
  (select to_emails from contract_reminders_due(date '2026-06-26') where kind = 'escalation' and contract_id = :'c2'),
  array['owner@sil.org']);

-- notice period 0 => deadline is the expiration date
\set c3 '00000000-0000-0000-0000-0000000000d3'
select t_contract(:'c3', date '2026-12-31', 0);
select t_eq('zero notice: deadline = expiry', (select notice_deadline from contracts where id = :'c3'), date '2026-12-31');

-- exclusions
\set c4 '00000000-0000-0000-0000-0000000000d4'
\set c5 '00000000-0000-0000-0000-0000000000d5'
\set c6 '00000000-0000-0000-0000-0000000000d6'
select t_contract(:'c4', date '2026-09-01', 60, null, true);                 -- evergreen
select t_contract(:'c5', date '2026-09-01', 60, null, false, false);         -- reminders off
select t_contract(:'c6', date '2026-09-01', 60);
update contracts set status = 'terminated' where id = :'c6';                 -- not active
select t_eq('evergreen has no notice deadline', (select notice_deadline from contracts where id = :'c4'), null::date);
select t_eq('evergreen / disabled / terminated are excluded',
  (select count(*)::int from contract_reminders_due(date '2026-06-26') where contract_id in (:'c4', :'c5', :'c6')), 0);

-- milestones
\set c7 '00000000-0000-0000-0000-0000000000d7'
select t_contract(:'c7', date '2030-01-01', 0);
insert into contract_milestones (id, contract_id, due_on, description) values
  ('00000000-0000-0000-0000-0000000000e1', :'c7', date '2026-06-11', 'Phase 1 delivery'),
  ('00000000-0000-0000-0000-0000000000e2', :'c7', date '2026-06-30', 'Phase 2 delivery');
select t_eq('milestone within 14 days is due; later one is not',
  (select count(*)::int from contract_reminders_due(date '2026-06-01') where kind = 'milestone' and contract_id = :'c7'), 1);
update contract_milestones set completed_at = now() where id = '00000000-0000-0000-0000-0000000000e1';
select t_eq('completed milestone is not reminded',
  (select count(*)::int from contract_reminders_due(date '2026-06-01') where kind = 'milestone' and contract_id = :'c7'), 0);
insert into contract_reminder_log (contract_id, milestone_id, kind, recipients, status)
values (:'c7', '00000000-0000-0000-0000-0000000000e2', 'milestone', '{owner@sil.org}', 'sent');
select t_eq('milestone reminder is sent only once',
  (select count(*)::int from contract_reminders_due(date '2026-06-20') where kind = 'milestone' and contract_id = :'c7'), 0);

-- admin-configurable lead times (R-R2)
update contract_settings set value = '[30]' where key = 'reminder_lead_days';
select t_eq('custom lead times are honoured (30 only)', (select string_agg(kind, ',' order by kind)
  from contract_reminders_due(date '2027-06-03') where contract_id = :'c1'), 'contract_end_notice_90,notice_30,termination_notice_30');

rollback;
