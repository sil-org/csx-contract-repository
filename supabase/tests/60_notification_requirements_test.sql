-- Unit tests for the six new notification requirements (07_notification_requirements.sql).
-- Dates are fixed so results are deterministic.
begin;

create function t_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL [%]: got %, want %', label, got, want;
  end if;
  raise notice 'ok   %', label;
end $$;

create function t_has(p_id uuid, p_today date, p_kind text) returns boolean
language sql stable as $$
  select exists (select 1 from contract_reminders_due(p_today) where contract_id = p_id and kind = p_kind)
$$;

insert into profiles (id, display_name, primary_email) values
  ('00000000-0000-0000-0000-00000000f0a1', 'Olive Owner', 'owner@sil.org');
insert into contract_counterparties (id, name) values ('00000000-0000-0000-0000-00000000f0c1', 'Acme Ltd');

-- Builds a draft contract; pass p_status := 'active' to attach an original and activate it.
-- p_complete controls whether the "new business data element" fields are filled in.
create function t_contract(
  p_id uuid, p_status contract_status, p_created_at timestamptz, p_exp date,
  p_term_date date default null, p_complete boolean default true, p_reminders boolean default true
) returns void language plpgsql as $$
declare v_type uuid := (select id from contract_types where form_kind = 'vendor' limit 1);
begin
  insert into contracts (
    id, title, type_id, counterparty_id, owner_id, department, created_at,
    effective_date, signed_date, expiration_date, notice_period_days, termination_date, reminders_enabled,
    system_name, annual_amount, mission_justification, signatory_name, signatory_email,
    department_manager, department_manager_email, contract_length_years
  ) values (
    p_id, 'Contract ' || left(p_id::text, 4), v_type, '00000000-0000-0000-0000-00000000f0c1',
    '00000000-0000-0000-0000-00000000f0a1', 'Ops', p_created_at,
    case when p_complete then date '2025-01-01' end,
    case when p_complete then date '2024-12-15' end,
    p_exp, 60, p_term_date, p_reminders,
    case when p_complete then 'Zoom' end,
    case when p_complete then 1000 end,
    case when p_complete then 'Mission reasons' end,
    case when p_complete then 'Jo Signer' end,
    case when p_complete then 'jo@acme.example' end,
    case when p_complete then 'Pat Manager' end,
    case when p_complete then 'pat@sil.org' end,
    case when p_complete then 2.0 end
  );
  if p_status = 'active' then
    insert into contract_documents (contract_id, doc_key, version, role, filename, content_type, size_bytes,
                                    sha256, s3_key, s3_version_id, change_note)
    values (p_id, gen_random_uuid(), 1, 'original', 'x.pdf', 'application/pdf', 10,
            repeat('a', 64), 'k/' || p_id, 'v1', 'initial');
    update contracts set status = 'active' where id = p_id;
  end if;
end $$;

-- ─── rows 1-2: date-approaching notices (90/30 day defaults) ────────────────
-- expiration 2026-09-01, notice 60 days => notice_deadline 2026-07-03.
\set c1 '00000000-0000-0000-0000-00000000f0d1'
select t_contract(:'c1', 'active', now(), date '2026-09-01');

select t_eq('91 days before notice deadline: nothing yet', t_has(:'c1', date '2026-04-03', 'termination_notice_90'), false);
select t_eq('90 days before notice deadline: termination_notice_90', t_has(:'c1', date '2026-04-04', 'termination_notice_90'), true);
select t_eq('30 days before notice deadline: termination_notice_30', t_has(:'c1', date '2026-06-03', 'termination_notice_30'), true);
select t_eq('91 days before end date: nothing yet', t_has(:'c1', date '2026-06-02', 'contract_end_notice_90'), false);
select t_eq('90 days before end date: contract_end_notice_90', t_has(:'c1', date '2026-06-03', 'contract_end_notice_90'), true);
select t_eq('30 days before end date: contract_end_notice_30', t_has(:'c1', date '2026-08-02', 'contract_end_notice_30'), true);

-- recipients: signatory + department manager (contract is complete, so both are set)
select t_eq('termination notice goes to signatory + department manager',
  (select to_emails from contract_reminders_due(date '2026-04-04') where contract_id = :'c1' and kind = 'termination_notice_90'),
  array['jo@acme.example', 'pat@sil.org']);

-- a recorded decision for the cycle suppresses the new notices too, same as the original ones
insert into contract_decisions (contract_id, notice_deadline, decision, rationale)
values (:'c1', date '2026-07-03', 'renew', 'Keep it');
select t_eq('decision suppresses termination_notice too', t_has(:'c1', date '2026-06-03', 'termination_notice_30'), false);

-- recipients fall back to the owner when signatory/dept-manager emails are both blank
\set c1b '00000000-0000-0000-0000-00000000f0d2'
select t_contract(:'c1b', 'active', now(), date '2026-09-01');
update contracts set signatory_email = null, department_manager_email = null where id = :'c1b';
select t_eq('falls back to owner when signatory/dept-manager emails are blank',
  (select to_emails from contract_reminders_due(date '2026-04-04') where contract_id = :'c1b' and kind = 'termination_notice_90'),
  array['owner@sil.org']);

-- ─── rows 3-4: missing data (2-week update / monthly escalation to named people) ──
\set c2 '00000000-0000-0000-0000-00000000f0d3'
select t_contract(:'c2', 'draft', timestamptz '2026-01-01 00:00:00+00', null, null, false);

select t_eq('13 days after add date: nothing yet', t_has(:'c2', date '2026-01-13', 'missing_data_update'), false);
select t_eq('14 days after add date: missing_data_update fires', t_has(:'c2', date '2026-01-15', 'missing_data_update'), true);
select t_eq('15 days after add date: not due again yet', t_has(:'c2', date '2026-01-16', 'missing_data_update'), false);
select t_eq('28 days after add date: fires again (biweekly)', t_has(:'c2', date '2026-01-29', 'missing_data_update'), true);

select t_eq('missing_fields lists what is actually missing', (
  select missing_fields @> array['System / product', 'Signatory name'] from contract_reminders_due(date '2026-01-15')
  where contract_id = :'c2' and kind = 'missing_data_update'), true);

-- escalation to named individuals: no rows until the settings are configured (empty by default)
select t_eq('30 days: escalation does not fire while recipient settings are empty', t_has(:'c2', date '2026-01-31', 'missing_data_escalation'), false);
update contract_settings set value = '["sheryl@sil.org", "mike@sil.org"]' where key = 'missing_data_escalation_emails';
select t_eq('30 days: escalation fires once recipients are configured', t_has(:'c2', date '2026-01-31', 'missing_data_escalation'), true);
select t_eq('escalation goes to the configured individuals, not the owner', (
  select to_emails from contract_reminders_due(date '2026-01-31') where contract_id = :'c2' and kind = 'missing_data_escalation'),
  array['sheryl@sil.org', 'mike@sil.org']);
select t_eq('60 days: escalation recurs monthly', t_has(:'c2', date '2026-03-02', 'missing_data_escalation'), true);
update contract_settings set value = '[]' where key = 'missing_data_escalation_emails';

-- filling in the missing fields stops both reminders on the next cycle
update contracts set system_name = 'Zoom', annual_amount = 1000, mission_justification = 'x',
  signatory_name = 'Jo Signer', signatory_email = 'jo@acme.example', department_manager = 'Pat Manager',
  department_manager_email = 'pat@sil.org', contract_length_years = 2.0,
  effective_date = date '2025-01-01', signed_date = date '2024-12-15', expiration_date = date '2030-01-01'
  where id = :'c2';
select t_eq('no longer missing once the record is completed', contract_missing_attrs(contracts), '{}'::text[]) from contracts where id = :'c2';
select t_eq('update reminder stops once complete', t_has(:'c2', date '2026-02-12', 'missing_data_update'), false);

-- ─── rows 5-6: termination date not recorded (immediate+biweekly / 30-day escalation) ──
\set c3 '00000000-0000-0000-0000-00000000f0d4'
select t_contract(:'c3', 'active', now(), date '2026-01-01');

select t_eq('end date day itself: fires immediately', t_has(:'c3', date '2026-01-01', 'termination_date_update'), true);
select t_eq('7 days past: not due again yet', t_has(:'c3', date '2026-01-08', 'termination_date_update'), false);
select t_eq('14 days past: fires again (biweekly)', t_has(:'c3', date '2026-01-15', 'termination_date_update'), true);

select t_eq('30 days past: escalation does not fire yet (threshold is "over" 30)', t_has(:'c3', date '2026-01-31', 'termination_date_escalation'), false);
select t_eq('31 days past: escalation does not fire while recipients are empty', t_has(:'c3', date '2026-02-01', 'termination_date_escalation'), false);
update contract_settings set value = '["cfo@sil.org", "cto@sil.org"]' where key = 'termination_escalation_emails';
select t_eq('31 days past: escalation fires once recipients are configured', t_has(:'c3', date '2026-02-01', 'termination_date_escalation'), true);
select t_eq('escalation goes to CFO/CTO, not the owner', (
  select to_emails from contract_reminders_due(date '2026-02-01') where contract_id = :'c3' and kind = 'termination_date_escalation'),
  array['cfo@sil.org', 'cto@sil.org']);
select t_eq('61 days past: escalation recurs monthly', t_has(:'c3', date '2026-03-03', 'termination_date_escalation'), true);
update contract_settings set value = '[]' where key = 'termination_escalation_emails';

-- recording the termination date stops both reminders
update contracts set termination_date = date '2026-01-20' where id = :'c3';
select t_eq('update reminder stops once termination_date is recorded', t_has(:'c3', date '2026-01-29', 'termination_date_update'), false);
select t_eq('escalation stops once termination_date is recorded', t_has(:'c3', date '2026-03-03', 'termination_date_escalation'), false);

-- ─── scope: terminated/expired/superseded/completed contracts are excluded ──
\set c4 '00000000-0000-0000-0000-00000000f0d5'
select t_contract(:'c4', 'active', now(), date '2026-01-01');
update contracts set status = 'terminated' where id = :'c4';
select t_eq('terminated contracts are excluded from the new kinds',
  (select count(*)::int from contract_reminders_due(date '2026-01-01') where contract_id = :'c4'), 0);

-- reminders_enabled = false is still honoured for the new kinds
\set c5 '00000000-0000-0000-0000-00000000f0d6'
select t_contract(:'c5', 'draft', timestamptz '2026-01-01 00:00:00+00', null, null, false, false);
select t_eq('reminders disabled: no missing_data_update', t_has(:'c5', date '2026-01-15', 'missing_data_update'), false);

rollback;
