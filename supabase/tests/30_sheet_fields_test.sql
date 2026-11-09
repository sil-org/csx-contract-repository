-- The columns that hold the tracking-sheet data (04_sheet_fields.sql): they save and read back
-- through row-level security, are audited, and reject nonsense.
begin;
create function t_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL [%]: got %, want %', label, got, want; end if;
  raise notice 'ok   %', label;
end $$;

insert into profiles (id, display_name, primary_email) values ('00000000-0000-0000-0000-0000000000a2', 'Cora', 'cora@sil.org');
insert into linked_accounts (supabase_user_id, profile_id, email) values ('10000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2', 'cora@sil.org');
insert into contract_roles (profile_id, role) values ('00000000-0000-0000-0000-0000000000a2', 'contributor');
insert into contract_counterparties (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Freshworks');

select t_eq('software type exists', (select count(*)::int from contract_types where name = 'Software subscription / system'), 1);

-- A contributor saves a row shaped exactly like the Freshworks entry in the sheet.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a2', true);
create temp table made(id uuid); grant all on made to authenticated;
with ins as (
  insert into contracts (title, system_name, type_id, counterparty_id, owner_id, department, department_manager,
      annual_amount, annual_amount_note, mission_justification, initial_contract_date, signatory_name,
      notice_period_days, notice_terms, last_renewal_date, expiration_date, administrators, corporate_license,
      google_sso, pricing_info, vendor_contact_note, notes)
  values ('Freshworks CRM', 'Freshworks CRM (Customer Relationship Management)',
      (select id from contract_types where name = 'Software subscription / system'),
      '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', 'GRO', 'Roy Eyre',
      35000, 'quoted as $35k', 'Donors are critical to our mission.', date '2020-11-06', 'Sheryl Howe',
      60, '60 days', date '2025-11-10', date '2026-11-10', 'crm-admin@sil.org', true,
      false, 'See most recent pricing', 'Do not contact the vendor without speaking to the department manager.',
      'https://drive.google.com/open?id=17jQN')
  returning id)
insert into made select id from ins;
reset role;
select t_eq('contributor can save and read back a sheet-shaped row', (select count(*)::int from made), 1);

select t_eq('last day to cancel matches the sheet (11/10/2026 - 60 days = 9/11/2026)',
  (select notice_deadline from contracts where title = 'Freshworks CRM'), date '2026-09-11');
select t_eq('annual amount stored as a number', (select annual_amount from contracts where title = 'Freshworks CRM'), 35000.00::numeric);
select t_eq('annual cost "in thousands" is derivable', (select (annual_amount / 1000)::int from contracts where title = 'Freshworks CRM'), 35);
select t_eq('yes / no answers are stored', (select (corporate_license, google_sso)::text from contracts where title = 'Freshworks CRM'), '(t,f)');

insert into contracts (title, type_id, counterparty_id, owner_id, department)
select 'Unknowns', (select id from contract_types limit 1), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', 'GTIS';
select t_eq('corporate license / Google login default to unknown (null), not "no"',
  (select (corporate_license is null and google_sso is null) from contracts where title = 'Unknowns'), true);

do $$ begin
  begin
    update contracts set annual_amount = -5 where title = 'Unknowns';
    raise exception 'FAIL [negative annual amount accepted]';
  exception when check_violation then raise notice 'ok   a negative annual amount is rejected'; end;
end $$;

update contracts set vendor_contact_note = 'Ask Roy first' where title = 'Freshworks CRM';
select t_eq('field change recorded in the audit log',
  (select new_values->>'vendor_contact_note' from contract_audit_log
   where entity = 'contracts' and action = 'update' and old_values ? 'vendor_contact_note' order by id desc limit 1), 'Ask Roy first');
rollback;
