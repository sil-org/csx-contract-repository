-- Field cleanup from colleague feedback (2026-11-12): several fields from the original spec
-- and the sheet import turned out not to be needed, and "Uses Google sign-in?" needed to
-- become a general sign-on-method field since vendors use more than just Google SSO.
--
-- Removed entirely (column dropped, not just hidden in the UI):
--   governing_law     -- not needed
--   binding_status    -- not needed (contract_binding enum type is left in place, unused)
--   parent_id         -- the SOW -> MSA linking feature ("Parent agreement"); custom_msa +
--                        an attached 'msa' document (migration 06) now covers that need.
--                        amends_id / superseded_by_id are untouched -- this only removes the
--                        separate parent/child relationship.
--
-- Reshaped:
--   google_sso (boolean yes/no/unknown) -> sign_on_methods (text[]: any of 'google','saml',
--   'local'). A vendor can support more than one, and "unknown" is no longer representable --
--   existing true values become ['google']; false/null become '{}' (not recorded).
--
-- Also removed: three vendor-detail keys that only ever lived in the `details` jsonb
-- (no column to drop) -- sla_summary, insurance_expiry, data_protection_terms.
--
-- Additive in spirit (old data is migrated, not just discarded blindly) and re-runnable.

-- ─── sign_on_methods (replaces google_sso) ─────────────────────────────────
alter table contracts add column if not exists sign_on_methods text[] not null default '{}';
do $$ begin
  alter table contracts add constraint contracts_sign_on_methods_check
    check (sign_on_methods <@ array['google', 'saml', 'local']::text[]);
exception when duplicate_object then null; end $$;

do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name = 'contracts' and column_name = 'google_sso') then
    update contracts set sign_on_methods = array['google']
      where google_sso = true and sign_on_methods = '{}';
    alter table contracts drop column google_sso;
  end if;
end $$;

-- ─── parent_id removal ──────────────────────────────────────────────────────
-- Drop any check constraint that references parent_id (the composite
-- "id <> parent_id and id <> amends_id and id <> superseded_by_id" check from 01) before
-- dropping the column, then restore the same guard for the two relationships that remain.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'contracts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%parent_id%'
  loop
    execute format('alter table contracts drop constraint %I', r.conname);
  end loop;
end $$;

alter table contracts drop column if exists parent_id;
drop index if exists contracts_parent_idx;

do $$ begin
  alter table contracts add constraint contracts_amends_supersede_check
    check (id <> amends_id and id <> superseded_by_id);
exception when duplicate_object then null; end $$;

-- ─── governing_law / binding_status removal ────────────────────────────────
alter table contracts drop column if exists governing_law;
alter table contracts drop column if exists binding_status;

-- ─── stale details-jsonb keys (vendor "Insurance/Compliance", "SLA Summary",
-- "Data Protection Terms Present" -- not real columns, no schema change needed) ──
update contracts set details = details - 'sla_summary' - 'insurance_expiry' - 'data_protection_terms'
  where details ?| array['sla_summary', 'insurance_expiry', 'data_protection_terms'];
