-- ─── CONTRACT REPOSITORY — CORE SCHEMA ──────────────────────────────────────
-- Runs in the SAME Supabase project as license-manager. Safe to re-run.
--
-- Depends on the shared auth kernel already installed by license-manager
-- (its supabase/schema.sql): profiles, linked_accounts, current_profile_id().
--
-- Rules for living in a shared database:
--   * Every table, type and function here is prefixed contract_ (or is a
--     plainly contract-specific name such as `contracts`).
--   * Nothing here alters or reads license-manager tables other than
--     profiles/linked_accounts, and never touches the shared user_role enum.
--   * Contract roles live in contract_roles, NOT profiles.role — a
--     license-manager admin has no contract access unless granted here.

-- ─── ENUMS ──────────────────────────────────────────────────────────────────
do $$ begin create type contract_role as enum ('viewer', 'contributor', 'auditor', 'admin');
exception when duplicate_object then null; end $$;
do $$ begin create type contract_status as enum ('draft', 'active', 'expired', 'terminated', 'superseded', 'completed');
exception when duplicate_object then null; end $$;
do $$ begin create type contract_binding as enum ('non_binding', 'partly_binding', 'binding');
exception when duplicate_object then null; end $$;
do $$ begin create type contract_sensitivity as enum ('standard', 'restricted');
exception when duplicate_object then null; end $$;
do $$ begin create type contract_renewal_type as enum ('none', 'automatic', 'option_to_renew', 'manual');
exception when duplicate_object then null; end $$;
do $$ begin create type contract_doc_role as enum ('original', 'amendment', 'exhibit', 'correspondence', 'other');
exception when duplicate_object then null; end $$;

-- ─── ROLES ──────────────────────────────────────────────────────────────────
create table if not exists contract_roles (
  profile_id  uuid primary key references profiles(id) on delete cascade,
  role        contract_role not null,
  granted_by  uuid references profiles(id),
  granted_at  timestamptz not null default now()
);

-- Helpers take an explicit profile id so Edge Functions (service role, no
-- auth.uid()) can run the same checks as RLS. The no-argument wrappers are
-- what policies and the frontend use.
create or replace function contract_role_of(p_profile uuid)
returns contract_role language sql stable security definer set search_path = public as $$
  select role from contract_roles where profile_id = p_profile
$$;

create or replace function contract_current_role()
returns contract_role language sql stable security definer set search_path = public as $$
  select contract_role_of(current_profile_id())
$$;

-- ─── REFERENCE DATA ─────────────────────────────────────────────────────────
-- form_kind picks which type-specific fields the UI shows (spec §4.5).
create table if not exists contract_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  form_kind  text not null default 'other' check (form_kind in ('mou', 'sow', 'vendor', 'other')),
  sort_order int  not null default 100,
  active     boolean not null default true
);

insert into contract_types (name, form_kind, sort_order) values
  ('Memorandum of Understanding (MOU)', 'mou', 10),
  ('Statement of Work (SOW)',           'sow', 20),
  ('Vendor contract / MSA',             'vendor', 30),
  ('Other',                             'other', 90)
on conflict (name) do nothing;

create table if not exists contract_counterparties (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists contract_counterparties_name_idx
  on contract_counterparties (lower(btrim(name)));

-- Key/value settings (admin-editable). See seed rows below.
create table if not exists contract_settings (
  key   text primary key,
  value jsonb not null
);
insert into contract_settings (key, value) values
  ('reminder_lead_days',        '[120, 60, 14]'),   -- days before the NOTICE deadline (R-R2)
  ('escalation_days',           '7'),               -- escalate if no decision this many days before
  ('milestone_lead_days',       '14'),
  ('escalation_fallback_email', 'null')             -- used when a contract has no backup owner
on conflict (key) do nothing;

-- ─── CONTRACTS ──────────────────────────────────────────────────────────────
create table if not exists contracts (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  type_id            uuid not null references contract_types(id),
  counterparty_id    uuid not null references contract_counterparties(id),
  owner_id           uuid not null references profiles(id),   -- R-U1: exactly one owner
  backup_owner_id    uuid references profiles(id),
  department         text not null,
  status             contract_status not null default 'draft',
  effective_date     date,
  expiration_date    date,
  evergreen          boolean not null default false,
  binding_status     contract_binding not null default 'binding',
  signed_date        date,
  governing_law      text,
  sensitivity        contract_sensitivity not null default 'standard',
  tags               text[] not null default '{}',
  notes              text,

  renewal_type       contract_renewal_type not null default 'none',
  renewal_term       text,
  -- Days before expiry that notice of non-renewal/termination is due.
  -- 0 means the notice deadline IS the expiration date.
  notice_period_days int not null default 0 check (notice_period_days >= 0),
  -- The date that actually protects the organization (R-R3).
  notice_deadline    date generated always as (
    case when expiration_date is not null and not evergreen
         then expiration_date - notice_period_days end
  ) stored,
  termination_for_convenience boolean,
  termination_notice_days     int check (termination_notice_days is null or termination_notice_days >= 0),

  value_amount       numeric(14,2),
  currency           text,
  payment_terms      text,
  billing_frequency  text,
  budget_code        text,

  parent_id          uuid references contracts(id),   -- SOW -> MSA (R-M1)
  amends_id          uuid references contracts(id),   -- amendment -> amended contract (R-M2)
  superseded_by_id   uuid references contracts(id),   -- R-M3

  details            jsonb not null default '{}',     -- type-specific fields (§4.5)
  provisions         jsonb not null default '{}',     -- provisions checklist (§4.6)
  reminders_enabled  boolean not null default true,

  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  check (expiration_date is null or effective_date is null or expiration_date >= effective_date),
  check (id <> parent_id and id <> amends_id and id <> superseded_by_id)
);
create index if not exists contracts_owner_idx          on contracts (owner_id);
create index if not exists contracts_status_idx         on contracts (status);
create index if not exists contracts_notice_deadline_idx on contracts (notice_deadline) where status = 'active';
create index if not exists contracts_parent_idx         on contracts (parent_id);

-- Named users who may see a Restricted contract (R-U3).
create table if not exists contract_access (
  contract_id uuid not null references contracts(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  granted_by  uuid references profiles(id),
  granted_at  timestamptz not null default now(),
  primary key (contract_id, profile_id)
);

-- ─── VISIBILITY / EDIT CHECKS ───────────────────────────────────────────────
create or replace function contract_can_view_as(p_profile uuid, p_contract uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_profile is not null and exists (
    select 1 from contracts c
    where c.id = p_contract and (
      contract_role_of(p_profile) in ('admin', 'auditor')
      or c.owner_id = p_profile
      or c.backup_owner_id = p_profile
      or (c.sensitivity = 'standard' and contract_role_of(p_profile) is not null)
      or exists (select 1 from contract_access a where a.contract_id = c.id and a.profile_id = p_profile)
    )
  )
$$;

-- Admins edit anything; contributors edit contracts they own or back up.
create or replace function contract_can_edit_as(p_profile uuid, p_contract uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_profile is not null and exists (
    select 1 from contracts c
    where c.id = p_contract and (
      contract_role_of(p_profile) = 'admin'
      or (contract_role_of(p_profile) = 'contributor'
          and (c.owner_id = p_profile or c.backup_owner_id = p_profile))
    )
  )
$$;

create or replace function contract_can_view(p_contract uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select contract_can_view_as(current_profile_id(), p_contract)
$$;
create or replace function contract_can_edit(p_contract uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select contract_can_edit_as(current_profile_id(), p_contract)
$$;
create or replace function contract_can_add() returns boolean
language sql stable security definer set search_path = public as $$
  select contract_current_role() in ('contributor', 'admin')
$$;
create or replace function contract_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(contract_current_role() = 'admin', false)
$$;
create or replace function contract_is_admin_or_auditor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(contract_current_role() in ('admin', 'auditor'), false)
$$;

-- ─── DOCUMENTS (append-only; originals are immutable — R-D1/R-D2/R-D7) ──────
-- Binary files live in S3 (versioning + Object Lock). This table is the index.
-- Rows are only ever inserted, by contract_register_document() via the
-- contract-documents Edge Function after it has verified the S3 object.
create table if not exists contract_documents (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references contracts(id),
  doc_key       uuid not null,            -- identifies one logical document across versions
  version       int  not null check (version >= 1),
  role          contract_doc_role not null,
  filename      text not null,
  content_type  text not null,
  size_bytes    bigint not null check (size_bytes > 0),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  s3_key        text not null,
  s3_version_id text not null,
  change_note   text not null check (btrim(change_note) <> ''),   -- R-D7
  uploaded_by   uuid references profiles(id),
  uploaded_at   timestamptz not null default now(),
  unique (doc_key, version)
);
create index if not exists contract_documents_contract_idx on contract_documents (contract_id);

create or replace function contract_block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% on % is not allowed: this table is append-only', tg_op, tg_table_name;
end $$;

drop trigger if exists contract_documents_immutable on contract_documents;
create trigger contract_documents_immutable
  before update or delete on contract_documents
  for each row execute function contract_block_mutation();

-- External (e.g. Google Drive) links — convenience only (R-D4).
create table if not exists contract_links (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references contracts(id) on delete cascade,
  url             text not null check (url ~* '^https?://'),
  label           text not null default 'Working copy',
  added_by        uuid references profiles(id),
  added_at        timestamptz not null default now(),
  last_checked_at timestamptz,   -- health checks are Phase 2 (R-D5)
  last_status     text
);

create table if not exists contract_milestones (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references contracts(id) on delete cascade,
  due_on       date not null,
  description  text not null,
  completed_at timestamptz
);
create index if not exists contract_milestones_due_idx on contract_milestones (due_on) where completed_at is null;

-- A recorded decision for one notice-deadline cycle stops further reminders
-- and escalation for that cycle (R-R5). When the dates change after a
-- renewal, the new deadline starts a new cycle.
create table if not exists contract_decisions (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references contracts(id) on delete cascade,
  notice_deadline date not null,
  decision        text not null check (decision in ('renew', 'renegotiate', 'terminate', 'no_action')),
  rationale       text,
  decided_by      uuid references profiles(id),
  decided_at      timestamptz not null default now(),
  unique (contract_id, notice_deadline)
);

-- ─── REMINDER LOG ───────────────────────────────────────────────────────────
-- Each reminder fires once per cycle: a 'sent' row is the "already done"
-- marker contract_reminders_due() checks. 'failed' rows are not markers, so
-- the next daily run retries them (R-R10); admins see them in the UI.
create table if not exists contract_reminder_log (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references contracts(id) on delete cascade,
  milestone_id    uuid references contract_milestones(id) on delete cascade,
  kind            text not null,   -- notice_<lead> | escalation | passed_deadline | milestone
  notice_deadline date,
  recipients      text[] not null default '{}',
  status          text not null check (status in ('sent', 'failed')),
  error           text,
  created_at      timestamptz not null default now()
);
create unique index if not exists contract_reminder_sent_once_idx
  on contract_reminder_log (contract_id, kind, notice_deadline)
  where status = 'sent' and milestone_id is null;
create unique index if not exists contract_reminder_milestone_sent_once_idx
  on contract_reminder_log (milestone_id, kind)
  where status = 'sent' and milestone_id is not null;

-- ─── AUDIT LOG (append-only — spec §9) ──────────────────────────────────────
create table if not exists contract_audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  profile_id  uuid,                 -- null for system/service actions
  action      text not null,        -- insert | update | delete | view | download | role_change ...
  entity      text not null,        -- table or logical entity
  entity_id   text,
  contract_id uuid,
  old_values  jsonb,
  new_values  jsonb,
  ip_address  text
);
create index if not exists contract_audit_log_contract_idx on contract_audit_log (contract_id, at desc);
create index if not exists contract_audit_log_at_idx       on contract_audit_log (at desc);

drop trigger if exists contract_audit_immutable on contract_audit_log;
create trigger contract_audit_immutable
  before update or delete on contract_audit_log
  for each row execute function contract_block_mutation();

create or replace function contract_request_ip() returns text
language plpgsql stable as $$
declare h json;
begin
  h := nullif(current_setting('request.headers', true), '')::json;
  return nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), '');
exception when others then
  return null;
end $$;

-- Generic row-level audit trigger. For updates, only changed columns are
-- recorded (old -> new), ignoring updated_at.
create or replace function contract_audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; k text;
  oc jsonb := '{}'; nc jsonb := '{}';
  v_contract uuid; v_id text;
begin
  if tg_op = 'INSERT' then n := to_jsonb(new);
  elsif tg_op = 'DELETE' then o := to_jsonb(old);
  else
    o := to_jsonb(old); n := to_jsonb(new);
    for k in select jsonb_object_keys(n) loop
      if k <> 'updated_at' and (o->k) is distinct from (n->k) then
        oc := oc || jsonb_build_object(k, o->k);
        nc := nc || jsonb_build_object(k, n->k);
      end if;
    end loop;
    if nc = '{}'::jsonb then return new; end if;
    o := oc; n := nc;
  end if;

  v_id := coalesce(n->>'id', o->>'id', n->>'profile_id', o->>'profile_id', n->>'key', o->>'key');
  -- Read via jsonb, not new.id: this trigger runs on tables that have no id column.
  v_contract := case when tg_table_name = 'contracts'
                     then nullif(coalesce(n->>'id', o->>'id'), '')::uuid
                     else nullif(coalesce(n->>'contract_id', o->>'contract_id'), '')::uuid end;

  insert into contract_audit_log (profile_id, action, entity, entity_id, contract_id, old_values, new_values, ip_address)
  values (current_profile_id(), lower(tg_op), tg_table_name, v_id, v_contract, o, n, contract_request_ip());

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['contracts', 'contract_documents', 'contract_links', 'contract_milestones',
                           'contract_decisions', 'contract_roles', 'contract_access', 'contract_settings',
                           'contract_types', 'contract_counterparties']
  loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I
                    for each row execute function contract_audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- Explicit view/download events (called by the contract-documents function).
create or replace function contract_log_access(p_profile uuid, p_contract uuid, p_document uuid, p_action text)
returns void language sql security definer set search_path = public as $$
  insert into contract_audit_log (profile_id, action, entity, entity_id, contract_id, ip_address)
  values (p_profile, p_action, 'contract_documents', p_document::text, p_contract, contract_request_ip())
$$;

-- ─── GUARDS ─────────────────────────────────────────────────────────────────
create or replace function contracts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, current_profile_id());
    if new.status <> 'draft' then
      raise exception 'New contracts must start as draft; upload the executed original, then activate.';
    end if;
  end if;

  -- Only admins may change sensitivity once set to restricted, or reassign owners
  -- of contracts they do not own — keep it simple: non-admins cannot downgrade.
  if tg_op = 'UPDATE' and old.sensitivity = 'restricted' and new.sensitivity <> 'restricted'
     and current_profile_id() is not null and not contract_is_admin() then
    raise exception 'Only an admin can change a restricted contract to standard.';
  end if;

  -- R-D1: cannot be Active without an executed original; required fields (§4.1).
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    if not exists (select 1 from contract_documents d where d.contract_id = new.id and d.role = 'original') then
      raise exception 'A contract cannot be Active without an uploaded executed original.';
    end if;
    if new.effective_date is null or new.signed_date is null then
      raise exception 'Effective date and signed date are required before activating.';
    end if;
    if new.expiration_date is null and not new.evergreen then
      raise exception 'Expiration date (or evergreen) is required before activating.';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists contracts_guard_trg on contracts;
create trigger contracts_guard_trg before insert or update on contracts
  for each row execute function contracts_guard();

-- Never remove the last contract admin (would lock everyone out).
create or replace function contract_roles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin')
     or (tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin') then
    if not exists (select 1 from contract_roles where role = 'admin' and profile_id <> old.profile_id) then
      raise exception 'Cannot remove the last contract admin.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists contract_roles_guard_trg on contract_roles;
create trigger contract_roles_guard_trg before update or delete on contract_roles
  for each row execute function contract_roles_guard();

-- ─── DOCUMENT REGISTRATION (service role only) ──────────────────────────────
create or replace function contract_register_document(
  p_profile       uuid,
  p_contract      uuid,
  p_doc_key       uuid,
  p_role          contract_doc_role,
  p_filename      text,
  p_content_type  text,
  p_size_bytes    bigint,
  p_sha256        text,
  p_s3_key        text,
  p_s3_version_id text,
  p_change_note   text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_key uuid; v_version int; v_id uuid;
begin
  if not contract_can_edit_as(p_profile, p_contract) then
    raise exception 'Not allowed to add documents to this contract.';
  end if;
  if p_role = 'original' and p_content_type <> 'application/pdf' then
    raise exception 'Executed originals must be PDF (R-D8).';
  end if;

  if p_doc_key is null then
    v_key := gen_random_uuid(); v_version := 1;
  else
    select coalesce(max(version), 0) + 1 into v_version
    from contract_documents
    where doc_key = p_doc_key and contract_id = p_contract and role = p_role;
    if v_version = 1 then
      raise exception 'Unknown document to version (doc_key does not match this contract and role).';
    end if;
    v_key := p_doc_key;
  end if;

  insert into contract_documents (contract_id, doc_key, version, role, filename, content_type, size_bytes,
                                  sha256, s3_key, s3_version_id, change_note, uploaded_by)
  values (p_contract, v_key, v_version, p_role, p_filename, p_content_type, p_size_bytes,
          lower(p_sha256), p_s3_key, p_s3_version_id, p_change_note, p_profile)
  returning id into v_id;
  return v_id;
end $$;

-- ─── REMINDERS DUE (service role only) ──────────────────────────────────────
-- Returns reminders that should be sent as of p_today, excluding anything
-- already logged as sent for the same cycle. Pure function of table state and
-- p_today, so it is unit-testable (supabase/tests/).
--
--  * notice_<lead>   Smallest configured lead already reached, once per cycle
--                    (so a contract entered late sends one catch-up reminder,
--                    not three). Anchored to the NOTICE deadline (R-R3).
--  * escalation      Within escalation_days of the deadline with no decision:
--                    to backup owner + fallback contact (R-R2).
--  * passed_deadline Notice deadline passed with no decision on an active
--                    contract — "renewed automatically?" (R-R7).
--  * milestone       Open milestone due within milestone_lead_days.
-- A recorded decision for the cycle suppresses notice/escalation/passed.
create or replace function contract_reminders_due(p_today date default current_date)
returns table (
  contract_id uuid, milestone_id uuid, kind text, notice_deadline date, due_on date,
  days_left int, title text, counterparty text, owner_name text, to_emails text[]
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_leads int[]; v_esc int; v_mlead int; v_fallback text;
begin
  select array(select (x)::int from jsonb_array_elements_text(value) x order by (x)::int)
    into v_leads from contract_settings where key = 'reminder_lead_days';
  if v_leads is null or cardinality(v_leads) = 0 then v_leads := array[14, 60, 120]; end if;
  select coalesce((value #>> '{}')::int, 7)  into v_esc   from contract_settings where key = 'escalation_days';
  select coalesce((value #>> '{}')::int, 14) into v_mlead from contract_settings where key = 'milestone_lead_days';
  select nullif(btrim(value #>> '{}'), '')   into v_fallback from contract_settings where key = 'escalation_fallback_email';
  v_esc := coalesce(v_esc, 7); v_mlead := coalesce(v_mlead, 14);

  return query
  with live as (
    select c.*, (c.notice_deadline - p_today) as dl,
           po.primary_email as owner_email, po.display_name as owner_name,
           pb.primary_email as backup_email, cp.name as cp_name
    from contracts c
    join profiles po on po.id = c.owner_id
    left join profiles pb on pb.id = c.backup_owner_id
    join contract_counterparties cp on cp.id = c.counterparty_id
    where c.status = 'active' and c.reminders_enabled and c.notice_deadline is not null
      and not exists (select 1 from contract_decisions d
                      where d.contract_id = c.id and d.notice_deadline = c.notice_deadline)
  ),
  notice as (
    select 'notice_' || (select min(x) from unnest(v_leads) x where x >= l.dl) as kind, l.*
    from live l
    where l.dl >= 0 and exists (select 1 from unnest(v_leads) x where x >= l.dl)
  ),
  esc as (
    select 'escalation'::text as kind, l.* from live l where l.dl >= 0 and l.dl <= v_esc
  ),
  passed as (
    select 'passed_deadline'::text as kind, l.* from live l where l.dl < 0
  ),
  allk as (
    select n.id, n.kind, n.notice_deadline, n.dl, n.title, n.cp_name, n.owner_name,
           array_remove(array[n.owner_email, n.backup_email], null) as tos from notice n
    union all
    select e.id, e.kind, e.notice_deadline, e.dl, e.title, e.cp_name, e.owner_name,
           array_remove(array[e.backup_email, v_fallback], null) from esc e
    union all
    select p.id, p.kind, p.notice_deadline, p.dl, p.title, p.cp_name, p.owner_name,
           array_remove(array[p.owner_email, p.backup_email], null) from passed p
  )
  select a.id, null::uuid, a.kind, a.notice_deadline, a.notice_deadline, a.dl::int, a.title, a.cp_name, a.owner_name,
         -- escalation with nobody to escalate to must not vanish silently:
         -- fall back to the owner so it is at least delivered.
         case when cardinality(a.tos) = 0
              then array[(select primary_email from profiles where id = (select owner_id from contracts where id = a.id))]
              else a.tos end
  from allk a
  where not exists (select 1 from contract_reminder_log r
                    where r.contract_id = a.id and r.kind = a.kind
                      and r.notice_deadline = a.notice_deadline and r.status = 'sent'
                      and r.milestone_id is null)
  union all
  select c.id, m.id, 'milestone', null::date, m.due_on, (m.due_on - p_today)::int, c.title, cp.name, po.display_name,
         array_remove(array[po.primary_email, pb.primary_email], null)
  from contract_milestones m
  join contracts c on c.id = m.contract_id
  join profiles po on po.id = c.owner_id
  left join profiles pb on pb.id = c.backup_owner_id
  join contract_counterparties cp on cp.id = c.counterparty_id
  where m.completed_at is null and c.status = 'active' and c.reminders_enabled
    and m.due_on - p_today between 0 and v_mlead
    and not exists (select 1 from contract_reminder_log r
                    where r.milestone_id = m.id and r.kind = 'milestone' and r.status = 'sent');
end $$;

-- ─── DIRECTORY / MY ROLE (frontend) ─────────────────────────────────────────
-- Owner pickers need staff names; profiles RLS only shows your own row.
create or replace function contract_directory()
returns table (id uuid, display_name text, primary_email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.primary_email
  from profiles p
  where contract_current_role() is not null
  order by p.display_name
$$;

create or replace function contract_my_role() returns contract_role
language sql stable security definer set search_path = public as $$
  select contract_current_role()
$$;

-- Admin user list: every profile with its contract role (if any).
create or replace function contract_admin_users()
returns table (profile_id uuid, display_name text, primary_email text, role contract_role)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.primary_email, r.role
  from profiles p left join contract_roles r on r.profile_id = p.id
  where contract_is_admin()
  order by p.display_name
$$;

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────────────────────
alter table contract_roles          enable row level security;
alter table contract_types          enable row level security;
alter table contract_counterparties enable row level security;
alter table contract_settings       enable row level security;
alter table contracts               enable row level security;
alter table contract_access         enable row level security;
alter table contract_documents      enable row level security;
alter table contract_links          enable row level security;
alter table contract_milestones     enable row level security;
alter table contract_decisions      enable row level security;
alter table contract_reminder_log   enable row level security;
alter table contract_audit_log      enable row level security;

-- Default for a new user is NO access (R-A5): every policy below requires a role.
drop policy if exists "contract_roles: read own or admin" on contract_roles;
create policy "contract_roles: read own or admin" on contract_roles for select
  using (profile_id = current_profile_id() or contract_is_admin());
drop policy if exists "contract_roles: admin write" on contract_roles;
create policy "contract_roles: admin write" on contract_roles for all
  using (contract_is_admin()) with check (contract_is_admin());

drop policy if exists "contract_types: read" on contract_types;
create policy "contract_types: read" on contract_types for select using (contract_current_role() is not null);
drop policy if exists "contract_types: admin write" on contract_types;
create policy "contract_types: admin write" on contract_types for all
  using (contract_is_admin()) with check (contract_is_admin());

drop policy if exists "contract_counterparties: read" on contract_counterparties;
create policy "contract_counterparties: read" on contract_counterparties for select
  using (contract_current_role() is not null);
drop policy if exists "contract_counterparties: add" on contract_counterparties;
create policy "contract_counterparties: add" on contract_counterparties for insert with check (contract_can_add());
drop policy if exists "contract_counterparties: admin update" on contract_counterparties;
create policy "contract_counterparties: admin update" on contract_counterparties for update
  using (contract_is_admin()) with check (contract_is_admin());

drop policy if exists "contract_settings: read" on contract_settings;
create policy "contract_settings: read" on contract_settings for select using (contract_current_role() is not null);
drop policy if exists "contract_settings: admin write" on contract_settings;
create policy "contract_settings: admin write" on contract_settings for all
  using (contract_is_admin()) with check (contract_is_admin());

drop policy if exists "contracts: view" on contracts;
-- The direct column checks matter: a STABLE helper that queries `contracts`
-- cannot see a row inserted by the same statement, so INSERT ... RETURNING
-- would fail the select policy without them.
create policy "contracts: view" on contracts for select
  using (owner_id = current_profile_id()
         or backup_owner_id = current_profile_id()
         or contract_is_admin_or_auditor()
         or contract_can_view(id));
drop policy if exists "contracts: add" on contracts;
-- Contributors create contracts they own or back up; admins can create for anyone.
create policy "contracts: add" on contracts for insert
  with check (contract_is_admin()
              or (contract_can_add()
                  and (owner_id = current_profile_id() or backup_owner_id = current_profile_id())));
drop policy if exists "contracts: edit" on contracts;
create policy "contracts: edit" on contracts for update
  using (contract_can_edit(id)) with check (contract_can_edit(id));
-- No delete policy: contracts are never deleted from the UI.

drop policy if exists "contract_access: view" on contract_access;
create policy "contract_access: view" on contract_access for select
  using (contract_can_edit(contract_id) or profile_id = current_profile_id());
drop policy if exists "contract_access: edit" on contract_access;
create policy "contract_access: edit" on contract_access for all
  using (contract_can_edit(contract_id)) with check (contract_can_edit(contract_id));

drop policy if exists "contract_documents: view" on contract_documents;
create policy "contract_documents: view" on contract_documents for select using (contract_can_view(contract_id));
-- No insert/update/delete policy: only contract_register_document() (service role) writes.

drop policy if exists "contract_links: view" on contract_links;
create policy "contract_links: view" on contract_links for select using (contract_can_view(contract_id));
drop policy if exists "contract_links: edit" on contract_links;
create policy "contract_links: edit" on contract_links for all
  using (contract_can_edit(contract_id)) with check (contract_can_edit(contract_id));

drop policy if exists "contract_milestones: view" on contract_milestones;
create policy "contract_milestones: view" on contract_milestones for select using (contract_can_view(contract_id));
drop policy if exists "contract_milestones: edit" on contract_milestones;
create policy "contract_milestones: edit" on contract_milestones for all
  using (contract_can_edit(contract_id)) with check (contract_can_edit(contract_id));

drop policy if exists "contract_decisions: view" on contract_decisions;
create policy "contract_decisions: view" on contract_decisions for select using (contract_can_view(contract_id));
drop policy if exists "contract_decisions: record" on contract_decisions;
create policy "contract_decisions: record" on contract_decisions for insert
  with check (contract_can_edit(contract_id) and decided_by = current_profile_id());

drop policy if exists "contract_reminder_log: admin/auditor read" on contract_reminder_log;
create policy "contract_reminder_log: admin/auditor read" on contract_reminder_log for select
  using (contract_is_admin_or_auditor());

drop policy if exists "contract_audit_log: admin/auditor read" on contract_audit_log;
create policy "contract_audit_log: admin/auditor read" on contract_audit_log for select
  using (contract_is_admin_or_auditor());

-- ─── GRANTS ─────────────────────────────────────────────────────────────────
-- Service-role-only functions: never callable from the browser.
revoke all on function contract_register_document(uuid, uuid, uuid, contract_doc_role, text, text, bigint, text, text, text, text) from public, anon, authenticated;
revoke all on function contract_reminders_due(date) from public, anon, authenticated;
revoke all on function contract_log_access(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function contract_can_view_as(uuid, uuid) from public, anon, authenticated;
revoke all on function contract_can_edit_as(uuid, uuid) from public, anon, authenticated;
revoke all on function contract_role_of(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function contract_register_document(uuid, uuid, uuid, contract_doc_role, text, text, bigint, text, text, text, text) to service_role;
    grant execute on function contract_reminders_due(date) to service_role;
    grant execute on function contract_log_access(uuid, uuid, uuid, text) to service_role;
    grant execute on function contract_can_view_as(uuid, uuid) to service_role;
    grant execute on function contract_can_edit_as(uuid, uuid) to service_role;
    grant execute on function contract_role_of(uuid) to service_role;
  end if;
end $$;

-- The audit log and reminder log are append-only to everyone but triggers/functions.
revoke insert, update, delete on contract_audit_log from anon, authenticated;
revoke insert, update, delete on contract_reminder_log from anon, authenticated;
