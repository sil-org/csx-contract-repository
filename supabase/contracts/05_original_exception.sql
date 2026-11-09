-- Admin-only "original not on file" exception (open decision #1 in CLAUDE.md, resolved 2026-10-08):
-- lets a contract become Active without an uploaded executed original, given a required reason.
-- Most migrated rows from the tracking sheet have no PDF and would otherwise stay drafts forever
-- and never get reminders. Additive and re-runnable; run after 01-04.

alter table contracts add column if not exists no_original_exception boolean not null default false;
alter table contracts add column if not exists no_original_reason text;
alter table contracts add column if not exists no_original_exception_set_by uuid references profiles(id);
alter table contracts add column if not exists no_original_exception_set_at timestamptz;

do $$ begin
  alter table contracts add constraint contracts_no_original_reason_chk
    check (not no_original_exception or btrim(coalesce(no_original_reason, '')) <> '');
exception when duplicate_object then null; end $$;

-- ─── GUARD: admin-only, reason required, activation unblocked ───────────────
-- Replaces the R-D1 check from 01_contracts_schema.sql and adds the admin-only
-- write restriction. Keep this in sync with contracts_guard() in 01 if that
-- function changes again.
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

  return new;
end $$;
