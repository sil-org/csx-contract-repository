-- Responsible-party (signatory) history (2026-11-12): on a long-running contract, whoever
-- originally signed is often not who's responsible now, and showing the two together (as the
-- detail page did, next to "Initial contract date") was misleading. Decided with the user:
--
--  * Scope is the SIGNATORY only -- not department_manager, which stays a single current field.
--  * "Current" = whichever history row's start_date is the latest one on or before today.
--  * contracts.signatory_name/signatory_email stay as a synced CACHE of the current row, kept
--    up to date by a trigger on this table -- contract_missing_attrs() and the reminder queries
--    in 07_notification_requirements.sql need no changes at all.
--
-- Additive and re-runnable; run after 01-08.

create table if not exists contract_signatories (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  email       text,
  start_date  date not null default current_date,   -- effective as of this date
  note        text,                                  -- e.g. "new hire, replacing Jo after the 2027 renewal"
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists contract_signatories_contract_idx on contract_signatories (contract_id, start_date desc);

alter table contract_signatories enable row level security;
drop policy if exists "contract_signatories: view" on contract_signatories;
create policy "contract_signatories: view" on contract_signatories for select using (contract_can_view(contract_id));
drop policy if exists "contract_signatories: edit" on contract_signatories;
create policy "contract_signatories: edit" on contract_signatories for all
  using (contract_can_edit(contract_id)) with check (contract_can_edit(contract_id));

-- Audited the same way every other contract child table is (the generic trigger function from 01;
-- this table didn't exist when 01's fixed audit-trigger loop ran, so it gets its own trigger here).
drop trigger if exists contract_signatories_audit on contract_signatories;
create trigger contract_signatories_audit after insert or update or delete on contract_signatories
  for each row execute function contract_audit_trigger();

-- ─── CURRENT-SIGNATORY SYNC ─────────────────────────────────────────────────
-- Recomputes contracts.signatory_name/signatory_email for one contract from its history: the row
-- with the latest start_date that is not in the future (ties broken by created_at).
create or replace function contract_sync_signatory(p_contract_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text; v_email text;
begin
  select s.name, s.email into v_name, v_email
  from contract_signatories s
  where s.contract_id = p_contract_id and s.start_date <= current_date
  order by s.start_date desc, s.created_at desc
  limit 1;

  update contracts set signatory_name = v_name, signatory_email = v_email
  where id = p_contract_id
    and (signatory_name is distinct from v_name or signatory_email is distinct from v_email);
end $$;

create or replace function contract_signatories_sync_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform contract_sync_signatory(coalesce(new.contract_id, old.contract_id));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists contract_signatories_sync on contract_signatories;
create trigger contract_signatories_sync after insert or update or delete on contract_signatories
  for each row execute function contract_signatories_sync_trigger();

-- A history edit/add/delete resyncs that one contract immediately. A future-dated entry becoming
-- current as its date arrives needs something to re-check it; contract-reminders (daily, via
-- pg_cron) calls this once before contract_reminders_due() so that catches up within a day.
create or replace function contract_resync_signatories() returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  for v_id in select distinct contract_id from contract_signatories loop
    perform contract_sync_signatory(v_id);
  end loop;
end $$;
revoke all on function contract_resync_signatories() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function contract_resync_signatories() to service_role;
  end if;
end $$;

-- Backfill: give every existing contract that already has a signatory a Day-1 history row (dated
-- to the initial contract date if known, else the effective date, else when the record was added),
-- so the history panel isn't empty for contracts entered before this migration.
insert into contract_signatories (contract_id, name, email, start_date, note)
select c.id, c.signatory_name, c.signatory_email,
       coalesce(c.initial_contract_date, c.effective_date, c.created_at::date),
       'Backfilled from the existing signatory field'
from contracts c
where nullif(btrim(c.signatory_name), '') is not null
  and not exists (select 1 from contract_signatories s where s.contract_id = c.id);
