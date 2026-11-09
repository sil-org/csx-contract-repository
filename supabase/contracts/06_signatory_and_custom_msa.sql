-- New, simplified field list from the business (2026-11-09): most of it already exists under other
-- names (Vendor -> counterparty, Software Name -> system_name, Annual/Total Cost -> annual_amount /
-- value_amount, Rationale -> mission_justification, Termination Notification Timeframe/Termination
-- Date -> the existing notice_period_days / notice_deadline). This migration adds what's actually new:
--
--  New data element                 -> contracts column
--  Signatory name                   -> signatory_name (renamed from initial_signer: same field, same
--                                      person, now understood as "who signed" generally, not just the
--                                      first-ever signer)
--  Signatory email                  -> signatory_email
--  Department Mgr email             -> department_manager_email (department_manager/name already exists)
--  Custom MSA (Y/N)                 -> custom_msa; if true, an uploaded document with role 'msa' is
--                                      required before the contract can go Active (mirrors the R-D1
--                                      executed-original rule)
--  Contract Length (years)          -> contract_length_years
--  Department (dropdown)            -> stays free text; the form offers autocomplete from departments
--                                      already in use, same pattern as Vendor/counterparty. No fixed
--                                      list was available to seed.
--
-- Additive and re-runnable; run after 01-05.

alter table contracts add column if not exists signatory_email          text;
alter table contracts add column if not exists department_manager_email text;
alter table contracts add column if not exists custom_msa               boolean not null default false;
alter table contracts add column if not exists contract_length_years    numeric(4,1)
  check (contract_length_years is null or contract_length_years >= 0);

-- Same field as before (whoever signed), just no longer named for the "initial" agreement only.
do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'contracts' and column_name = 'initial_signer')
     and not exists (select 1 from information_schema.columns where table_name = 'contracts' and column_name = 'signatory_name') then
    alter table contracts rename column initial_signer to signatory_name;
  end if;
end $$;

-- A copy of the custom MSA is an attached document, not an "original" — give it its own role.
alter type contract_doc_role add value if not exists 'msa';

-- ─── GUARD: adds the custom-MSA-requires-a-document rule ───────────────────
-- Replaces contracts_guard() from 01/05. Keep this in sync if that function changes again.
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

  -- Only an admin may grant, change the reason for, or revoke the "original not
  -- on file" exception.
  if ((tg_op = 'INSERT' and new.no_original_exception)
      or (tg_op = 'UPDATE' and (old.no_original_exception is distinct from new.no_original_exception
                                or coalesce(old.no_original_reason, '') is distinct from coalesce(new.no_original_reason, ''))))
     and current_profile_id() is not null and not contract_is_admin() then
    raise exception 'Only an admin can set the "original not on file" exception.';
  end if;
  if new.no_original_exception and (tg_op = 'INSERT'
      or old.no_original_exception is distinct from new.no_original_exception
      or coalesce(old.no_original_reason, '') is distinct from coalesce(new.no_original_reason, '')) then
    new.no_original_exception_set_by := current_profile_id();
    new.no_original_exception_set_at := now();
  elsif not new.no_original_exception then
    new.no_original_exception_set_by := null;
    new.no_original_exception_set_at := null;
  end if;

  -- R-D1: cannot be Active without an executed original, unless an admin has
  -- recorded the "original not on file" exception with a reason; required
  -- fields either way (§4.1).
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    if not exists (select 1 from contract_documents d where d.contract_id = new.id and d.role = 'original')
       and not new.no_original_exception then
      raise exception 'A contract cannot be Active without an uploaded executed original, or an admin-recorded exception.';
    end if;
    if new.effective_date is null or new.signed_date is null then
      raise exception 'Effective date and signed date are required before activating.';
    end if;
    if new.expiration_date is null and not new.evergreen then
      raise exception 'Expiration date (or evergreen) is required before activating.';
    end if;
  end if;

  -- Custom MSA: a copy must be attached (role 'msa') before the contract is Active —
  -- checked at first activation, and again if custom_msa is switched on afterward.
  if new.status = 'active' and new.custom_msa
     and (tg_op = 'INSERT' or old.status is distinct from 'active' or old.custom_msa is distinct from new.custom_msa)
     and not exists (select 1 from contract_documents d where d.contract_id = new.id and d.role = 'msa') then
    raise exception 'This contract has a custom MSA; attach a copy of the MSA (document type "MSA copy") before activating.';
  end if;

  return new;
end $$;
