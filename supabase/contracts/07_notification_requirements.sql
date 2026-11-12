-- New notification requirements from the business (2026-11-11): six reminder categories beyond the
-- existing owner/backup notice-deadline cycle (R-R2/R-R3), sent instead to the signatory and
-- department manager (or, for the two escalations, to named individuals via admin-configurable
-- settings). Decisions made resolving ambiguity in the business's table, confirmed with the user:
--
--  * "Termination Date" (rows 5-6) is a NEW, manually-entered field (termination_date) recording
--    when a contract was actually confirmed terminated/not renewed. It is NOT the existing computed
--    notice_deadline (which migration 06 calls "Termination Date" in the sheet-mapping sense, but
--    which is auto-derived and so is never meaningfully "unpopulated" the way rows 5-6 need).
--  * The missing-data checks (rows 3-4) cover the "new business data element list" (system_name,
--    cost, mission_justification, signatory name/email, department manager name/email, contract
--    length, effective/signed/end dates) -- excluding termination_date, amended_date and
--    amendment_description, which the business explicitly exempts, and excluding not-null columns
--    that can never be "missing" (counterparty, department, custom_msa).
--  * Sheryl Nelson / Mike Painter / CFO / CTO are not contract fields -- their emails are
--    admin-configurable settings (missing_data_escalation_emails / termination_escalation_emails),
--    following the existing escalation_fallback_email pattern. Empty by default: these two reminder
--    kinds simply produce no rows until an admin sets them.
--  * Applies to 'draft' and 'active' contracts (not terminated/expired/superseded/completed), per the
--    user: missing-data nagging should start as soon as a record is added, not only once active.
--
-- amended_date / amendment_description are also new: the business's exemption list named them, but
-- no such columns existed yet (only amends_id, a link to the amended contract).
--
-- Additive and re-runnable; run after 01-06.

alter table contracts add column if not exists termination_date      date;
alter table contracts add column if not exists amended_date          date;
alter table contracts add column if not exists amendment_description text;

insert into contract_settings (key, value) values
  -- Lead days before the computed notice deadline / the contract end date, for the two
  -- "date approaching" notices (rows 1-2). Same shape as the existing reminder_lead_days.
  ('termination_notice_lead_days',   '[90, 30]'),
  ('contract_end_lead_days',         '[90, 30]'),
  -- First-fire delay AND recurrence interval (days), reused for both, matching the business's
  -- "N days after add date ... retrigger every N" / "... recurring each N" phrasing (rows 3-4).
  ('missing_data_update_days',       '14'),
  ('missing_data_escalation_days',   '30'),
  -- Row 5: no initial delay ("Contract End Date is in the past"), recurs every N days.
  ('termination_date_update_days',   '14'),
  -- Row 6: fires once a contract end date is more than N days past, recurring every N days.
  ('termination_date_escalation_days', '30'),
  -- Named individuals, not contract fields. Empty until an admin sets them (Settings page).
  ('missing_data_escalation_emails', '[]'),
  ('termination_escalation_emails',  '[]')
on conflict (key) do nothing;

-- ─── MISSING-ATTRIBUTE CHECK (rows 3-4) ─────────────────────────────────────
-- The "new business data element list" (migration 06), minus the three fields the business
-- exempts (termination_date, amended_date, amendment_description) and minus not-null columns
-- that can never be "missing" (counterparty_id, department, custom_msa).
create or replace function contract_missing_attrs(c contracts) returns text[]
language sql immutable as $$
  select array_remove(array[
    case when nullif(btrim(c.system_name), '')             is null then 'System / product' end,
    case when c.annual_amount is null and c.value_amount is null  then 'Annual or total cost' end,
    case when nullif(btrim(c.mission_justification), '')   is null then 'Mission justification' end,
    case when nullif(btrim(c.signatory_name), '')          is null then 'Signatory name' end,
    case when nullif(btrim(c.signatory_email), '')         is null then 'Signatory email' end,
    case when nullif(btrim(c.department_manager), '')      is null then 'Department manager' end,
    case when nullif(btrim(c.department_manager_email), '') is null then 'Department manager email' end,
    case when c.contract_length_years is null              then 'Contract length (years)' end,
    case when c.effective_date is null                     then 'Effective date' end,
    case when c.signed_date is null                        then 'Signed date' end,
    case when c.expiration_date is null and not c.evergreen then 'Contract end date (or evergreen)' end
  ], null)
$$;

-- ─── RECURRING-REMINDER HELPER (rows 3-6) ───────────────────────────────────
-- True on the day a recurring reminder is due: p_first_delay days after p_anchor, then every
-- p_interval days after that, forever (until the caller's own condition stops being true).
create or replace function contract_recurs_on(p_today date, p_anchor date, p_first_delay int, p_interval int)
returns boolean language sql immutable as $$
  select p_anchor is not null and p_interval > 0
     and (p_today - p_anchor) >= p_first_delay
     and ((p_today - p_anchor) - p_first_delay) % p_interval = 0
$$;

-- ─── REMINDERS DUE — extended with the six new categories ──────────────────
-- Return shape gained `missing_fields` (populated only for the missing_data_* kinds), so the
-- function must be dropped first (CREATE OR REPLACE cannot change output columns).
drop function if exists contract_reminders_due(date);

create or replace function contract_reminders_due(p_today date default current_date)
returns table (
  contract_id uuid, milestone_id uuid, kind text, notice_deadline date, due_on date,
  days_left int, title text, counterparty text, owner_name text, to_emails text[], missing_fields text[]
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_leads int[]; v_esc int; v_mlead int; v_fallback text;
  v_term_leads int[]; v_end_leads int[];
  v_mdu_days int; v_mde_days int; v_tdu_days int; v_tde_days int;
  v_mde_emails text[]; v_tde_emails text[];
begin
  select array(select (x)::int from jsonb_array_elements_text(value) x order by (x)::int)
    into v_leads from contract_settings where key = 'reminder_lead_days';
  if v_leads is null or cardinality(v_leads) = 0 then v_leads := array[14, 60, 120]; end if;
  select coalesce((value #>> '{}')::int, 7)  into v_esc   from contract_settings where key = 'escalation_days';
  select coalesce((value #>> '{}')::int, 14) into v_mlead from contract_settings where key = 'milestone_lead_days';
  select nullif(btrim(value #>> '{}'), '')   into v_fallback from contract_settings where key = 'escalation_fallback_email';
  v_esc := coalesce(v_esc, 7); v_mlead := coalesce(v_mlead, 14);

  select array(select (x)::int from jsonb_array_elements_text(value) x order by (x)::int)
    into v_term_leads from contract_settings where key = 'termination_notice_lead_days';
  if v_term_leads is null or cardinality(v_term_leads) = 0 then v_term_leads := array[30, 90]; end if;
  select array(select (x)::int from jsonb_array_elements_text(value) x order by (x)::int)
    into v_end_leads from contract_settings where key = 'contract_end_lead_days';
  if v_end_leads is null or cardinality(v_end_leads) = 0 then v_end_leads := array[30, 90]; end if;

  select coalesce((value #>> '{}')::int, 14) into v_mdu_days from contract_settings where key = 'missing_data_update_days';
  select coalesce((value #>> '{}')::int, 30) into v_mde_days from contract_settings where key = 'missing_data_escalation_days';
  select coalesce((value #>> '{}')::int, 14) into v_tdu_days from contract_settings where key = 'termination_date_update_days';
  select coalesce((value #>> '{}')::int, 30) into v_tde_days from contract_settings where key = 'termination_date_escalation_days';
  v_mdu_days := coalesce(v_mdu_days, 14); v_mde_days := coalesce(v_mde_days, 30);
  v_tdu_days := coalesce(v_tdu_days, 14); v_tde_days := coalesce(v_tde_days, 30);

  select coalesce(array(select jsonb_array_elements_text(value)), '{}')
    into v_mde_emails from contract_settings where key = 'missing_data_escalation_emails';
  select coalesce(array(select jsonb_array_elements_text(value)), '{}')
    into v_tde_emails from contract_settings where key = 'termination_escalation_emails';

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
  -- ── new categories: 'draft' and 'active', signatory + department manager (rows 1-6) ──────
  live2 as (
    select c.*, po.primary_email as owner_email, po.display_name as owner_name, cp.name as cp_name,
           (p_today - c.expiration_date) as days_past_end,
           contract_missing_attrs(c) as missing,
           array_remove(array[nullif(btrim(c.signatory_email), ''), nullif(btrim(c.department_manager_email), '')], null) as stakeholders,
           c.notice_deadline - p_today as dl
    from contracts c
    join profiles po on po.id = c.owner_id
    join contract_counterparties cp on cp.id = c.counterparty_id
    where c.status in ('draft', 'active') and c.reminders_enabled
  ),
  term_notice as (
    -- Row 1: "notice of termination date approaching" -- 3mo/1mo before the computed notice deadline.
    select 'termination_notice_' || (select min(x) from unnest(v_term_leads) x where x >= l.dl) as kind, l.*
    from live2 l
    where l.notice_deadline is not null and l.dl >= 0 and exists (select 1 from unnest(v_term_leads) x where x >= l.dl)
      and (l.notice_deadline is null or not exists (select 1 from contract_decisions d
                                                     where d.contract_id = l.id and d.notice_deadline = l.notice_deadline))
  ),
  end_notice as (
    -- Row 2: "notice of contract end date approaching" -- 3mo/1mo before the contract end date itself.
    select 'contract_end_notice_' || (select min(x) from unnest(v_end_leads) x where x >= (l.expiration_date - p_today)) as kind, l.*
    from live2 l
    where l.expiration_date is not null and not l.evergreen and (l.expiration_date - p_today) >= 0
      and exists (select 1 from unnest(v_end_leads) x where x >= (l.expiration_date - p_today))
      and (l.notice_deadline is null or not exists (select 1 from contract_decisions d
                                                     where d.contract_id = l.id and d.notice_deadline = l.notice_deadline))
  ),
  missing_update as (
    -- Row 3: 2 weeks after the record was added, retriggering every 2 weeks, while any attribute is missing.
    select 'missing_data_update'::text as kind, l.* from live2 l
    where cardinality(l.missing) > 0 and contract_recurs_on(p_today, l.created_at::date, v_mdu_days, v_mdu_days)
  ),
  missing_escalation as (
    -- Row 4: 1 month after the record was added, recurring monthly, to named individuals.
    select 'missing_data_escalation'::text as kind, l.* from live2 l
    where cardinality(l.missing) > 0 and contract_recurs_on(p_today, l.created_at::date, v_mde_days, v_mde_days)
      and cardinality(v_mde_emails) > 0
  ),
  term_date_update as (
    -- Row 5: the end date is in the past and termination_date isn't recorded; every 2 weeks until it is.
    select 'termination_date_update'::text as kind, l.* from live2 l
    where l.expiration_date is not null and l.termination_date is null
      and contract_recurs_on(p_today, l.expiration_date, 0, v_tdu_days)
  ),
  term_date_escalation as (
    -- Row 6: the end date is more than a month past and still not recorded; escalate to named individuals.
    select 'termination_date_escalation'::text as kind, l.* from live2 l
    where l.expiration_date is not null and l.termination_date is null
      and contract_recurs_on(p_today, l.expiration_date, v_tde_days + 1, v_tde_days)
      and cardinality(v_tde_emails) > 0
  ),
  allk as (
    select n.id, n.kind, n.notice_deadline, n.dl, n.title, n.cp_name, n.owner_name,
           array_remove(array[n.owner_email, n.backup_email], null) as tos, null::text[] as missing from notice n
    union all
    select e.id, e.kind, e.notice_deadline, e.dl, e.title, e.cp_name, e.owner_name,
           array_remove(array[e.backup_email, v_fallback], null), null::text[] from esc e
    union all
    select p.id, p.kind, p.notice_deadline, p.dl, p.title, p.cp_name, p.owner_name,
           array_remove(array[p.owner_email, p.backup_email], null), null::text[] from passed p
  )
  select a.id, null::uuid, a.kind, a.notice_deadline, a.notice_deadline, a.dl::int, a.title, a.cp_name, a.owner_name,
         -- escalation with nobody to escalate to must not vanish silently:
         -- fall back to the owner so it is at least delivered.
         case when cardinality(a.tos) = 0
              then array[(select primary_email from profiles where id = (select owner_id from contracts where id = a.id))]
              else a.tos end,
         a.missing
  from allk a
  where not exists (select 1 from contract_reminder_log r
                    where r.contract_id = a.id and r.kind = a.kind
                      and r.notice_deadline = a.notice_deadline and r.status = 'sent'
                      and r.milestone_id is null)
  union all
  select c.id, m.id, 'milestone', null::date, m.due_on, (m.due_on - p_today)::int, c.title, cp.name, po.display_name,
         array_remove(array[po.primary_email, pb.primary_email], null), null::text[]
  from contract_milestones m
  join contracts c on c.id = m.contract_id
  join profiles po on po.id = c.owner_id
  left join profiles pb on pb.id = c.backup_owner_id
  join contract_counterparties cp on cp.id = c.counterparty_id
  where m.completed_at is null and c.status = 'active' and c.reminders_enabled
    and m.due_on - p_today between 0 and v_mlead
    and not exists (select 1 from contract_reminder_log r
                    where r.milestone_id = m.id and r.kind = 'milestone' and r.status = 'sent')
  -- ── the six new kinds: dedupe on (contract, kind, cycle-anchor) same as above; the
  -- cycle-anchor reuses the notice_deadline column as a generic "cycle key" (today's date for
  -- the recurring kinds, since the recurrence condition is only true on one day per cycle) ──
  union all
  select t.id, null::uuid, t.kind, t.notice_deadline, t.notice_deadline, t.dl::int, t.title, t.cp_name, t.owner_name,
         case when cardinality(t.stakeholders) = 0 then array[t.owner_email] else t.stakeholders end, null::text[]
  from term_notice t
  where not exists (select 1 from contract_reminder_log r
                    where r.contract_id = t.id and r.kind = t.kind and r.notice_deadline = t.notice_deadline and r.status = 'sent')
  union all
  select e.id, null::uuid, e.kind, e.expiration_date, e.expiration_date, (e.expiration_date - p_today)::int, e.title, e.cp_name, e.owner_name,
         case when cardinality(e.stakeholders) = 0 then array[e.owner_email] else e.stakeholders end, null::text[]
  from end_notice e
  where not exists (select 1 from contract_reminder_log r
                    where r.contract_id = e.id and r.kind = e.kind and r.notice_deadline = e.expiration_date and r.status = 'sent')
  union all
  select u.id, null::uuid, u.kind, p_today, u.created_at::date, (p_today - u.created_at::date)::int, u.title, u.cp_name, u.owner_name,
         case when cardinality(u.stakeholders) = 0 then array[u.owner_email] else u.stakeholders end, u.missing
  from missing_update u
  where not exists (select 1 from contract_reminder_log r
                    where r.contract_id = u.id and r.kind = u.kind and r.notice_deadline = p_today and r.status = 'sent')
  union all
  select g.id, null::uuid, g.kind, p_today, g.created_at::date, (p_today - g.created_at::date)::int, g.title, g.cp_name, g.owner_name,
         v_mde_emails, g.missing
  from missing_escalation g
  where not exists (select 1 from contract_reminder_log r
                    where r.contract_id = g.id and r.kind = g.kind and r.notice_deadline = p_today and r.status = 'sent')
  union all
  select d.id, null::uuid, d.kind, p_today, d.expiration_date, d.days_past_end::int, d.title, d.cp_name, d.owner_name,
         case when cardinality(d.stakeholders) = 0 then array[d.owner_email] else d.stakeholders end, null::text[]
  from term_date_update d
  where not exists (select 1 from contract_reminder_log r
                    where r.contract_id = d.id and r.kind = d.kind and r.notice_deadline = p_today and r.status = 'sent')
  union all
  select x.id, null::uuid, x.kind, p_today, x.expiration_date, x.days_past_end::int, x.title, x.cp_name, x.owner_name,
         v_tde_emails, null::text[]
  from term_date_escalation x
  where not exists (select 1 from contract_reminder_log r
                    where r.contract_id = x.id and r.kind = x.kind and r.notice_deadline = p_today and r.status = 'sent');
end $$;

revoke all on function contract_reminders_due(date) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function contract_reminders_due(date) to service_role;
  end if;
end $$;
