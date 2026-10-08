-- Fields needed to hold everything in the existing "Software Subscriptions" tracking sheet
-- (tabs: SIL Core Operational Systems, Contract Management, Other Systems). Additive and
-- re-runnable; run after 01. Nothing here changes existing columns or rules.
--
--  Sheet column                                 -> contracts column
--  System / Name of service                     -> system_name
--  Department Manager                           -> department_manager
--  Annual Amount (Vendor License only)          -> annual_amount (+ annual_amount_note for the free text:
--                                                  "+ fees 2%...", "internal", "Free?", "Atlassian donation")
--  Annual cost in thousands                     -> derived (annual_amount / 1000); not stored
--  One paragraph on why this advances mission   -> mission_justification
--  Initial Contract Date / Signer               -> initial_contract_date / initial_signer
--  Renewal Notice Terms                         -> notice_period_days (+ notice_terms for the wording as written)
--  Last Renewal Date                            -> last_renewal_date
--  Next Renewal Date                            -> expiration_date (the date the current term renews/ends)
--  Last Day to Cancel Renewal                   -> notice_deadline (computed: next renewal - notice period)
--  Notes (often a Drive link)                   -> notes / contract_links
--  Corporate license? / Google authentication?  -> corporate_license / google_sso (yes / no / unknown)
--  Administrator(s)                             -> administrators
--  More information (pricing etc.)              -> pricing_info
--  "...will not contact a vendor without        -> vendor_contact_note
--   speaking to the department manager"

alter table contracts add column if not exists system_name         text;
alter table contracts add column if not exists department_manager  text;
alter table contracts add column if not exists annual_amount       numeric(14,2) check (annual_amount is null or annual_amount >= 0);
alter table contracts add column if not exists annual_amount_note  text;
alter table contracts add column if not exists mission_justification text;
alter table contracts add column if not exists initial_contract_date date;
alter table contracts add column if not exists initial_signer      text;
alter table contracts add column if not exists last_renewal_date   date;
alter table contracts add column if not exists notice_terms        text;
alter table contracts add column if not exists administrators      text;
alter table contracts add column if not exists corporate_license   boolean;   -- null = unknown
alter table contracts add column if not exists google_sso          boolean;   -- null = unknown
alter table contracts add column if not exists pricing_info        text;
alter table contracts add column if not exists vendor_contact_note text;

create index if not exists contracts_system_name_idx on contracts (lower(system_name));

-- The sheet tracks software systems and subscriptions; give them their own type.
insert into contract_types (name, form_kind, sort_order)
values ('Software subscription / system', 'vendor', 25)
on conflict (name) do nothing;
