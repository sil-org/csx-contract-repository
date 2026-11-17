-- ─── FAKE TEST CONTRACTS — for exercising the UI, NOT a schema migration ────
-- Run by hand in the Supabase SQL Editor, same project as everything else
-- (there's no separate dev/test project). Safe to run against the real,
-- shared project and safe to re-run (it deletes its own previous output
-- first, matched by the fixed 'eeee0000-…' id prefix / 'seed-test' tag).
--
-- Safety properties, on purpose:
--   * reminders_enabled is forced false on every row, regardless of dates,
--     so the daily pg_cron job / contract_reminders_due() never touches
--     these and nobody gets a real email about fake data.
--   * All emails use the '.test' TLD (IANA-reserved, never resolves/
--     delivers — see RFC 2606) — not example.com, to fully rule out mail.
--   * owner_id is YOUR OWN profile (looked up by email below), so these
--     show up under your name in "My contracts" / owner filters.
--   * No contract_documents rows are created. That table is append-only
--     and immutable (R-D2) — a fake document row could never be cleaned
--     up again, so instead a few rows use the admin "original not on
--     file" exception to reach Active without one. The one thing this
--     CANNOT simulate is custom_msa + Active (that needs a real 'msa'
--     document) — contract #3 below is left in Draft to show the
--     "must attach MSA before activating" banner instead.
--   * Every row is tagged 'seed-test', so typing that into the Contracts
--     search box finds exactly these (search includes tags).
--
-- To remove everything this script created, just re-run it with no new
-- inserts after the cleanup block, or run the cleanup block alone.

-- ─── CLEANUP (previous run, if any) ─────────────────────────────────────────
update contracts set amends_id = null, superseded_by_id = null
  where id::text like 'eeee0000-%';
delete from contract_decisions  where contract_id::text like 'eeee0000-%';
delete from contract_milestones where contract_id::text like 'eeee0000-%';
delete from contract_links      where contract_id::text like 'eeee0000-%';
delete from contract_access     where contract_id::text like 'eeee0000-%';
delete from contracts           where id::text like 'eeee0000-%';
delete from contract_counterparties cp
  where cp.name like '%(Test)' and not exists (select 1 from contracts c where c.counterparty_id = cp.id);

-- Before running the rest: confirm this returns one row (edit the email
-- below, and everywhere else in this file, if it's not you) —
--   select id from profiles where primary_email = 'kate_brenner@sil.org';
-- If it finds nobody, every insert below will fail with a clear enough
-- "null value in column owner_id violates not-null constraint".

-- ─── REFERENCE DATA ─────────────────────────────────────────────────────────
insert into contract_counterparties (name) values
  ('Literacy Partners Alliance (Test)'),
  ('Acme Testing Corp (Test)'),
  ('Testopia CRM Inc. (Test)'),
  ('Fixture Video Conferencing Co. (Test)'),
  ('Sandbox Compliance Partners (Test)'),
  ('Mock Logistics Group (Test)')
on conflict (lower(btrim(name))) do nothing;

-- Change this if you want the fake contracts owned by someone else.
-- (Must be a real profile — shared with license-manager.)
-- select id from profiles where primary_email = 'kate_brenner@sil.org'

-- ─── BATCH A: contracts with no cross-references ────────────────────────────
insert into contracts (
  id, title, type_id, counterparty_id, owner_id, department, status,
  effective_date, expiration_date, evergreen, signed_date,
  sensitivity, tags, notes, renewal_type, renewal_term, notice_period_days,
  termination_for_convenience, termination_notice_days, value_amount, currency,
  reminders_enabled, system_name, department_manager, department_manager_email,
  annual_amount, annual_amount_note, mission_justification, initial_contract_date,
  signatory_name, signatory_email, last_renewal_date, notice_terms, administrators,
  corporate_license, sign_on_methods, pricing_info, vendor_contact_note,
  custom_msa, contract_length_years, superseded_by_id
) values
-- #1 MOU, evergreen, will go Active
('eeee0000-0000-0000-0000-000000000001', 'Literacy Partners Alliance MOU',
 (select id from contract_types where name = 'Memorandum of Understanding (MOU)'),
 (select id from contract_counterparties where name = 'Literacy Partners Alliance (Test)'),
 (select id from profiles where primary_email = 'kate_brenner@sil.org'),
 'ZZ Test - Partnerships', 'draft',
 '2025-01-15', null, true, '2025-01-10',
 'standard', array['seed-test'], 'Fake data for UI testing. Owner/dates/financials are fictitious.',
 'none', null, 0,
 null, null, null, null,
 false, null, 'Priya Natarajan', 'priya.natarajan@example.test',
 null, null,
 'Partnering with Literacy Partners Alliance extends adult literacy programming to three additional language communities our field teams already serve, directly supporting the mother-tongue literacy goals of our mission.',
 '2025-01-15', 'Owen Castellano', 'owen.castellano@example.test', null, null, null,
 null, '{}', null, null,
 false, null, null),

-- #2 SOW, will go Active
('eeee0000-0000-0000-0000-000000000002', 'Field Data Collection App — Build',
 (select id from contract_types where name = 'Statement of Work (SOW)'),
 (select id from contract_counterparties where name = 'Acme Testing Corp (Test)'),
 (select id from profiles where primary_email = 'kate_brenner@sil.org'),
 'ZZ Test - IT', 'draft',
 '2026-06-01', '2026-11-30', false, '2026-05-20',
 'standard', array['seed-test'], 'Fake data for UI testing. Owner/dates/financials are fictitious.',
 'none', null, 0,
 null, null, 28000.00, 'USD',
 false, null, 'Marcus Webb', 'marcus.webb@example.test',
 null, null,
 'Funds development of an offline-first mobile app for recording endangered-language wordlists in the field, directly feeding our language documentation mission.',
 null, 'Renee Okafor', 'renee.okafor@example.test', null, null, null,
 null, '{}', null, null,
 false, 0.5, null),

-- #3 Vendor/MSA with Custom MSA checked — LEFT IN DRAFT (needs a real 'msa'
-- document to activate; this is the one scenario this script can't fake)
('eeee0000-0000-0000-0000-000000000003', 'Mock Logistics — Field Supply MSA (custom terms)',
 (select id from contract_types where name = 'Vendor contract'),
 (select id from contract_counterparties where name = 'Mock Logistics Group (Test)'),
 (select id from profiles where primary_email = 'kate_brenner@sil.org'),
 'ZZ Test - Logistics', 'draft',
 null, null, false, null,
 'standard', array['seed-test'], 'Fake data for UI testing. Custom MSA checked on purpose — try activating it, it should be blocked until an "MSA copy" document is attached.',
 'none', null, 0,
 null, null, null, null,
 false, null, 'Dana Whitfield', 'dana.whitfield@example.test',
 null, null, null,
 null, null, null, null, null,
 null, null, '{}', null, null,
 true, null, null),

-- #4 Vendor/MSA, Active — the successor to #12
('eeee0000-0000-0000-0000-000000000004', 'Acme SecureDrive — Vendor MSA',
 (select id from contract_types where name = 'Vendor contract'),
 (select id from contract_counterparties where name = 'Acme Testing Corp (Test)'),
 (select id from profiles where primary_email = 'kate_brenner@sil.org'),
 'ZZ Test - IT', 'draft',
 '2026-01-15', '2027-01-15', false, '2026-01-05',
 'standard', array['seed-test', 'core-operational'], 'Fake data for UI testing. Owner/dates/financials are fictitious.',
 'automatic', '12 months', 60,
 null, null, 45000.00, 'USD',
 false, 'Acme SecureDrive (Test)', 'Marcus Webb', 'marcus.webb@example.test',
 15000.00, 'Year 1 discounted rate',
 'Acme SecureDrive gives translation teams in low-bandwidth field locations a reliable way to sync draft Scripture and literacy materials with reviewers, directly supporting accurate, timely translation work.',
 '2026-01-15', 'Owen Castellano', 'owen.castellano@example.test', '2026-01-15', '60 days before renewal', 'it-admin@example.test',
 true, array['google'], 'Quoted per-seat, volume discount at 50+', 'Do not contact the vendor without speaking to the department manager.',
 false, 3.0, null),

-- #5 Software subscription, Active, full "sheet-style" fields populated
('eeee0000-0000-0000-0000-000000000005', 'Testopia CRM',
 (select id from contract_types where name = 'Software subscription / system'),
 (select id from contract_counterparties where name = 'Testopia CRM Inc. (Test)'),
 (select id from profiles where primary_email = 'kate_brenner@sil.org'),
 'ZZ Test - CRM Ops', 'draft',
 '2026-03-01', '2027-03-01', false, '2026-02-20',
 'standard', array['seed-test', 'core-operational'], 'Fake data for UI testing. Owner/dates/financials are fictitious.',
 'automatic', '12 months', 45,
 null, null, null, 'USD',
 false, 'Testopia CRM (Donor & Partner Relations)', 'Priya Natarajan', 'priya.natarajan@example.test',
 12000.00, 'billed annually',
 'Testopia CRM tracks relationships with the churches, agencies and individual partners who fund and pray for our translation projects, letting a small advancement team maintain personal relationships at a scale that would otherwise require many more staff.',
 '2026-03-01', 'Owen Castellano', 'owen.castellano@example.test', '2026-03-01', '45 days before renewal', 'crm-admin@example.test',
 true, array['google'], 'See most recent pricing sheet', null,
 false, 1.0, null),

-- #6 Software subscription, Active, evergreen, corporate_license/sign-on method UNKNOWN
('eeee0000-0000-0000-0000-000000000006', 'Fixture Meet',
 (select id from contract_types where name = 'Software subscription / system'),
 (select id from contract_counterparties where name = 'Fixture Video Conferencing Co. (Test)'),
 (select id from profiles where primary_email = 'kate_brenner@sil.org'),
 'ZZ Test - Comms', 'draft',
 '2025-06-01', null, true, '2025-05-28',
 'standard', array['seed-test'], 'Fake data for UI testing. Owner/dates/financials are fictitious.',
 'none', null, 0,
 null, null, null, 'USD',
 false, 'Fixture Meet (Test)', 'Dana Whitfield', 'dana.whitfield@example.test',
 6000.00, null,
 'Fixture Meet lets translation consultants review drafts with remote field teams without costly travel, shortening the consultant-check cycle for minority-language Scripture translation.',
 '2025-06-01', 'Renee Okafor', 'renee.okafor@example.test', null, null, null,
 null, '{}', null, null,
 false, null, null),

-- #7 Vendor, Expired (straight to Expired — never passed through Active, so
-- no original/exception is required by the guard)
('eeee0000-0000-0000-0000-000000000007', 'Sandbox ComplySuite — lapsed subscription',
 (select id from contract_types where name = 'Vendor contract'),
 (select id from contract_counterparties where name = 'Sandbox Compliance Partners (Test)'),
 (select id from profiles where primary_email = 'kate_brenner@sil.org'),
 'ZZ Test - Compliance', 'draft',
 '2025-08-01', '2026-08-01', false, '2025-07-25',
 'standard', array['seed-test'], 'Fake data for UI testing. Owner/dates/financials are fictitious.',
 'manual', null, 30,
 null, null, null, 'USD',
 false, 'Sandbox ComplySuite (Test)', null, null,
 18000.00, null, null,
 null, null, null, null, null,
 null, null, '{}', null, null,
 false, null, null),

-- #8 Vendor, Terminated for convenience
('eeee0000-0000-0000-0000-000000000008', 'Mock Logistics — Materials Shipping Contract',
 (select id from contract_types where name = 'Vendor contract'),
 (select id from contract_counterparties where name = 'Mock Logistics Group (Test)'),
 (select id from profiles where primary_email = 'kate_brenner@sil.org'),
 'ZZ Test - Logistics', 'draft',
 '2025-01-01', '2026-06-30', false, '2024-12-20',
 'standard', array['seed-test'], 'Fake data for UI testing. Owner/dates/financials are fictitious.',
 'manual', null, 30,
 true, 30, 52000.00, 'USD',
 false, null, null, null,
 null, null, null,
 null, null, null, null, null,
 null, null, '{}', null, null,
 false, null, null),

-- #9 MOU, Completed
('eeee0000-0000-0000-0000-000000000009', 'Literacy Partners Alliance — 2024 Pilot MOU (closed out)',
 (select id from contract_types where name = 'Memorandum of Understanding (MOU)'),
 (select id from contract_counterparties where name = 'Literacy Partners Alliance (Test)'),
 (select id from profiles where primary_email = 'kate_brenner@sil.org'),
 'ZZ Test - Partnerships', 'draft',
 '2024-01-01', '2025-12-31', false, '2023-12-15',
 'standard', array['seed-test'], 'Fake data for UI testing. Owner/dates/financials are fictitious.',
 'none', null, 0,
 null, null, null, null,
 false, null, null, null,
 null, null,
 'Prior one-year literacy pilot with the same partner, completed and superseded by the ongoing MOU above.',
 null, 'Owen Castellano', 'owen.castellano@example.test', null, null, null,
 null, '{}', null, null,
 false, null, null),

-- #10 Other, Draft, Restricted (sensitive background-check vendor, still being negotiated)
('eeee0000-0000-0000-0000-00000000000a', 'Sandbox Compliance — background check services (draft, restricted)',
 (select id from contract_types where name = 'Other'),
 (select id from contract_counterparties where name = 'Sandbox Compliance Partners (Test)'),
 (select id from profiles where primary_email = 'kate_brenner@sil.org'),
 'ZZ Test - Compliance', 'draft',
 null, null, false, null,
 'restricted', array['seed-test'], 'Fake data for UI testing. Restricted on purpose — check a Viewer/Contributor without access can''t see it.',
 'none', null, 0,
 null, null, null, null,
 false, null, 'Dana Whitfield', 'dana.whitfield@example.test',
 null, null, null,
 null, null, null, null, null,
 null, null, '{}', null, null,
 false, null, null),

-- #11 Vendor, Active, notice deadline already PASSED (like the
-- Zoom/Freshworks examples already in CLAUDE.md — good for dashboard testing)
('eeee0000-0000-0000-0000-00000000000b', 'Fixture Webinar — Training Platform',
 (select id from contract_types where name = 'Vendor contract'),
 (select id from contract_counterparties where name = 'Fixture Video Conferencing Co. (Test)'),
 (select id from profiles where primary_email = 'kate_brenner@sil.org'),
 'ZZ Test - Comms', 'draft',
 '2025-12-01', '2026-12-01', false, '2025-11-20',
 'standard', array['seed-test'], 'Fake data for UI testing. Notice deadline is intentionally already passed.',
 'automatic', '12 months', 30,
 null, null, null, 'USD',
 false, 'Fixture Webinar (Test)', 'Dana Whitfield', 'dana.whitfield@example.test',
 9000.00, null,
 'Hosts quarterly training webinars for national translators who cannot travel to a central training site.',
 '2025-12-01', 'Renee Okafor', 'renee.okafor@example.test', null, null, null,
 null, '{}', null, null,
 false, 2.0, null)
;

-- ─── BATCH B: contracts that reference the ones above ──────────────────────
insert into contracts (
  id, title, type_id, counterparty_id, owner_id, department, status,
  effective_date, expiration_date, evergreen, signed_date,
  sensitivity, tags, notes, renewal_type, renewal_term, notice_period_days,
  termination_for_convenience, termination_notice_days, value_amount, currency,
  reminders_enabled, system_name, department_manager, department_manager_email,
  annual_amount, annual_amount_note, mission_justification, initial_contract_date,
  signatory_name, signatory_email, last_renewal_date, notice_terms, administrators,
  corporate_license, sign_on_methods, pricing_info, vendor_contact_note,
  custom_msa, contract_length_years, superseded_by_id
) values
-- #12 Vendor, Superseded by #4 (the old Acme MSA this replaced)
('eeee0000-0000-0000-0000-00000000000c', 'Acme SecureDrive — original MSA (superseded)',
 (select id from contract_types where name = 'Vendor contract'),
 (select id from contract_counterparties where name = 'Acme Testing Corp (Test)'),
 (select id from profiles where primary_email = 'kate_brenner@sil.org'),
 'ZZ Test - IT', 'draft',
 '2024-07-01', '2026-10-01', false, '2024-06-20',
 'standard', array['seed-test'], 'Fake data for UI testing. Replaced by the current Acme MSA.',
 'manual', null, 30,
 null, null, 40000.00, 'USD',
 false, 'Acme SecureDrive (Test)', 'Marcus Webb', 'marcus.webb@example.test',
 null, null, null,
 '2024-07-01', 'Owen Castellano', 'owen.castellano@example.test', null, null, null,
 null, '{}', null, null,
 false, null, 'eeee0000-0000-0000-0000-000000000004')
;

-- ─── STATUS TRANSITIONS ──────────────────────────────────────────────────────
-- New contracts must start as draft (R-D1 guard); these move the ones that
-- should demo an active/expired/terminated/completed/superseded state.
-- "no_original_exception" stands in for an uploaded executed original —
-- there's no real file, so the reason says so plainly.

-- -> Active (needs the admin exception since there's no real document)
update contracts set status = 'active', no_original_exception = true,
  no_original_reason = 'Seed test data — no physical original on file.'
  where id in (
    'eeee0000-0000-0000-0000-000000000001',
    'eeee0000-0000-0000-0000-000000000002',
    'eeee0000-0000-0000-0000-000000000004',
    'eeee0000-0000-0000-0000-000000000005',
    'eeee0000-0000-0000-0000-000000000006',
    'eeee0000-0000-0000-0000-00000000000b'
  );

-- -> Expired / Terminated / Completed / Superseded (never passed through
-- Active, so the original-document guard doesn't apply to these)
update contracts set status = 'expired'     where id = 'eeee0000-0000-0000-0000-000000000007';
update contracts set status = 'terminated' where id = 'eeee0000-0000-0000-0000-000000000008';
update contracts set status = 'completed'  where id = 'eeee0000-0000-0000-0000-000000000009';
update contracts set status = 'superseded' where id = 'eeee0000-0000-0000-0000-00000000000c';

-- (#3 and #10 are left in Draft on purpose — see comments above.)

-- ─── A COUPLE OF MILESTONES AND A DECISION, FOR FLAVOR ──────────────────────
insert into contract_milestones (contract_id, due_on, description) values
  ('eeee0000-0000-0000-0000-000000000004', '2026-12-01', 'Confirm renewed pricing with vendor rep'),
  ('eeee0000-0000-0000-0000-000000000001', '2027-01-15', 'Annual partnership check-in call');

insert into contract_decisions (contract_id, notice_deadline, decision, rationale, decided_by) values
  ('eeee0000-0000-0000-0000-00000000000c', '2026-09-01', 'renegotiate',
   'Replaced with a new MSA (Acme SecureDrive) at better terms.',
   (select id from profiles where primary_email = 'kate_brenner@sil.org'));

-- ─── DONE ────────────────────────────────────────────────────────────────────
select id, title, status, sensitivity, custom_msa, no_original_exception
from contracts where id::text like 'eeee0000-%' order by title;
