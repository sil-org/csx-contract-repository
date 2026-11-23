# Contract Repository — working notes for Claude Code

Repository of record for MOUs, SOWs and vendor contracts: the executed original of every agreement is
kept unaltered, and the responsible people are reminded before notice deadlines. **Not** an e-signature
tool (no drafting, routing or signing). Requirements: `docs/REQUIREMENTS.md`. Setup: `SETUP.md`.

## Architecture (decisions already made — don't relitigate without asking)
- **Frontend:** React + Vite + Tailwind from `sil-app-template`, hosted on **AWS Amplify** (builds on push to `main`).
- **Backend:** the **same Supabase project as `license-manager`** — same `profiles` / `linked_accounts`. Sign-in
  is SAML SSO (`VITE_SSO_PROVIDER_ID`), the same provider registered project-wide (shared with license-manager
  and helpdesk); this app is SSO-only — no Google button here (license-manager still offers Google alongside SSO
  for its own existing users; don't assume this app follows that pattern). Because the project is shared:
  - Everything here is `contract_`-prefixed (or plainly contract-specific). **Never alter license-manager tables,
    types or functions**, and never touch the shared `user_role` enum.
  - **Contract roles are separate** (`contract_roles`: viewer / contributor / auditor / admin). A license-manager
    admin has no contract access unless granted. This is tested.
  - Edge Function **secrets are project-wide**: check for name collisions with license-manager before adding any.
  - The deploy workflow lists functions by name; it must never deploy `send-email` (owned by license-manager).
- **Documents:** private **S3** bucket, versioning + Object Lock (governance mode for now — don't move to
  compliance until retention periods are confirmed; irreversible). Binaries never go in Git. The browser uploads
  with presigned URLs from `contract-documents`; `contract_documents` rows are append-only.
- **Business rules live in Postgres** (RLS, triggers, `contract_reminders_due()`), not in the frontend.
- **Reminders:** daily `pg_cron` → `contract-reminders` Edge Function → license-manager's `send-email`
  (`app: 'contracts'`, sender "Contract Repository"). Anchored to the **notice deadline**, not the expiry.

## Where things are
- `supabase/contracts/` — migrations **01–05**, run by hand in the Supabase SQL Editor, in order. All re-runnable.
  `02` needs pg_cron/Vault (Supabase only). When changing the schema, add a new numbered file; don't edit one
  that has already been run in production unless it stays safe to re-run.
- `supabase/functions/` — `contract-documents`, `contract-reminders`, `_shared`.
- `supabase/tests/` — SQL tests + `run.sh`; `supabase/tests/functions/` — reminder-handler test.
- `tests/ui/` — browser tests against a mocked API (see its README).
- `infra/` — S3 bucket script, CORS, least-privilege IAM policy (no delete permissions).
- `src/` — pages, `lib/contracts.js` (all data access), `lib/documents.js` (S3 flow), `context/AuthContext.jsx`.

## Commands
```bash
npm install && cp .env.example .env   # same VITE_SUPABASE_URL / ANON_KEY / SSO_PROVIDER_ID as license-manager
npm run dev                           # http://localhost:5173
npm run build

# SQL tests — throwaway local Postgres, no Docker. Needs PostgreSQL server binaries + psql, and the shared
# auth kernel from license-manager (profiles, linked_accounts, current_profile_id):
supabase/tests/run.sh ../license-manager/supabase/schema.sql      # bash; on Windows use WSL/Git Bash

# Edge Function handler test (needs Deno):
deno run -A --no-check supabase/tests/functions/contract_reminders_e2e.ts
# Type-check functions from a COPY outside this repo (package.json changes how Deno resolves npm: imports),
# with {"nodeModulesDir":"auto"} in a deno.json there.
```
Run the SQL suite after any change to `supabase/contracts/`; it is the safety net for date logic and access rules.
When a test passes for the wrong reason it has bitten us before (fake users that didn't match linked accounts):
keep the positive-control checks, and for a new rule, break it on purpose once to prove the test can fail.

## Workflow
- Work on a branch, open a PR to `main`. **Merging to `main` rebuilds the Amplify site** (and redeploys functions if
  `supabase/functions/**` changed). Run any new migration in Supabase **before** merging the app change that needs it.
- Commit trailer used so far: `Co-Authored-By: Claude …` / `Claude-Session: …` (optional now).
- Never commit secrets. Don't paste the CRON secret, AWS keys or Supabase tokens into chats.

## State as of 2026-10-08 (update this section as things change)
- Live: app on Amplify, migrations 01–03 + 02 run, Edge Functions deployed, daily reminder job scheduled,
  license-manager `send-email` fix merged (PR #22) and tested by a real email.
- Migrations 01–06 are merged to `main` (the `ccr-0927e7de-2f6zv7` branch noted here earlier is in; this
  line was stale — corrected 2026-11-11).
- **Branch `notification-requirements` has unmerged work (2026-11-11):** migration
  `07_notification_requirements.sql` — six new reminder categories from the business's notification
  requirements table, on top of the existing owner/backup notice-deadline cycle:
  1. **Termination notice approaching** (90/30 days before the computed notice deadline) and
  2. **Contract end date approaching** (90/30 days before the end date) — both to the signatory +
     department manager, admin-configurable lead times.
  3. **Missing-data update** (14 days after the record is added, repeating every 14 days while any
     required field is blank) and
  4. **Missing-data escalation** (30 days, repeating monthly) — (3) to the signatory + department
     manager, (4) to named individuals (e.g. Sheryl Nelson / Mike Painter) via the new
     `missing_data_escalation_emails` setting — empty by default, so it won't send until an admin sets it.
     "Missing" covers the business's data-element list (system name, cost, mission justification,
     signatory/dept-mgr name+email, contract length, effective/signed/end dates); `termination_date`,
     `amended_date` and `amendment_description` are explicitly exempt (and are new fields themselves —
     the business's exemption list named them, but they didn't exist in the schema yet).
  5. **Termination-date update** (fires the day the end date passes, repeating every 2 weeks) and
  6. **Termination-date escalation** (fires 31+ days past the end date, repeating monthly) — both
     condition on a contract having passed its end date with the new manual `termination_date` field
     still unrecorded; (6) goes to named individuals (e.g. CFO/CTO) via `termination_escalation_emails`,
     same empty-by-default pattern as (4).
  Applies to `draft` and `active` contracts (not terminated/expired/superseded/completed), per the
  business: missing-data nagging should start as soon as a record is added. All six are configurable on
  the admin Settings page (lead times, intervals, and the two escalation recipient lists). Covered by
  `supabase/tests/60_notification_requirements_test.sql` — the full SQL suite (this machine has no
  native PostgreSQL binaries, so it was run via a disposable `postgres:16-alpine` Docker container
  instead of `run.sh`'s normal `initdb`/`pg_ctl` path) passes, 2026-11-12. That run also surfaced two
  issues the suite had never actually caught before (no local Postgres/Docker had been available until
  now): `10_reminders_test.sql`'s fixed expectations didn't account for the new termination/end-date
  notices now legitimately co-firing alongside the old notice tiers on several of its test dates (fixed
  — not a migration bug, just un-updated assertions); and `50_signatory_custom_msa_test.sql` had a
  latent, pre-existing bug unrelated to this branch (its custom-MSA activation test never attached an
  executed original either, so `contracts_guard()`'s original-on-file check fired first instead of the
  MSA check it meant to test — fixed by attaching one). **Migration 07 has been run against the real
  Supabase project (2026-11-12).**
  Also in this branch: the contract detail page's section nav is now a sticky left sidebar (`md:` and up;
  falls back to the horizontal bar on narrow screens) instead of a horizontal bar at the top
  (`SectionNav` in `src/components/ui.jsx` gained an `orientation` prop).
- **Built (2026-11-09):** the S3 bucket (`sil-contract-repository`, `us-east-1`) is created — Object Lock +
  versioning on, public access blocked, SSE-S3 encryption, governance-mode 7-year placeholder retention, CORS
  for `contracts.sil.org` / `localhost:5173` / the Amplify preview URL. The AWS/CORS secret names are now
  `CONTRACTS_`-prefixed (`CONTRACTS_AWS_ACCESS_KEY_ID`, `CONTRACTS_AWS_SECRET_ACCESS_KEY`, `CONTRACTS_AWS_REGION`,
  `CONTRACTS_ALLOWED_ORIGINS`, plus the already-distinct `CONTRACTS_BUCKET` / `CONTRACTS_APP_ORIGIN`) — changed
  from the old generic `AWS_*` / `ALLOWED_ORIGINS` names because secrets are project-wide and those could've
  collided with another app's secret of the same name (`CRON_SECRET` stays unprefixed; it's deliberately shared).
- **Not done:** the limited runtime IAM user from `infra/iam-policy.json` (for `sil-contract-repository`) and
  setting the Supabase secrets above — uploads don't work until then, and first real upload is the first test
  of the presigned-checksum flow. The reminder dry run (`SETUP.md` step 7) hasn't been run against real data.
- **Built (2026-10-08):** the "original not on file" exception — an admin can mark a contract
  `no_original_exception` with a required `no_original_reason`, which lets it activate without an uploaded
  executed original (`contracts_guard()` in `05_original_exception.sql`; only an admin may set, change the
  reason for, or revoke it). Shown as an amber badge on the contract list/detail pages; set in the admin-only
  "Activation exception" section of the contract form. Covered by `supabase/tests/40_original_exception_test.sql`.
- **Built (2026-11-09):** a new, simplified data-element list from the business mapped mostly onto existing
  fields (Vendor → counterparty, Software Name → system_name, Annual/Total Cost → annual_amount / value_amount,
  Rationale → mission_justification, Termination Notification Timeframe/Date → the existing
  notice_period_days / notice_deadline). What's actually new, in `06_signatory_and_custom_msa.sql`:
  `signatory_name` (renamed from `initial_signer` — same field/person, not just the first-ever signer) +
  `signatory_email`, `department_manager_email`, `contract_length_years`, and `custom_msa` (Y/N; if Y, a
  document with role `msa` must be attached before the contract can go Active — enforced in
  `contracts_guard()`, same shape as the executed-original rule). Department stayed free text with
  autocomplete (no fixed department list was available to seed a lookup table). Covered by
  `supabase/tests/50_signatory_custom_msa_test.sql`.
- **Built (2026-11-12):** field cleanup from colleague feedback on the form — `08_field_cleanup.sql`:
  - Dropped entirely (column + UI): `governing_law`, `binding_status` (the `contract_binding` enum type is
    left in place, unused), and `parent_id` — the SOW→MSA "Parent agreement" linking feature. `custom_msa` +
    an attached `msa` document (migration 06) already cover that need; `amends_id`/`superseded_by_id` and the
    Related Contracts panel are untouched.
  - `google_sso` (yes/no/unknown) → `sign_on_methods` (`text[]`, checked against `google`/`saml`/`local`):
    a vendor can use more than one, and "unknown" is no longer representable — old `true` became `['google']`,
    `false`/`null` became `'{}'`. UI is now a checkbox group, not a select.
  - Three vendor-detail keys that only ever lived in the `details` jsonb (no column) — `sla_summary`,
    `insurance_expiry`, `data_protection_terms` — are gone from the form/detail page and wiped from existing
    rows' `details`.
  - "Counterparty" relabeled to **Vendor** everywhere in the UI (list column/filter/search, the contract form) —
    the business already calls it that (see the migration 06 note above); the `contract_counterparties` table/
    `counterparty_id` column keep their names.
  - Made required on the contract form: initial contract date, signatory name/email, signed date, effective
    date, expiration date (unless evergreen), contract length, notice period, annual amount, and the mission
    field (relabeled **"Rationale: Why this software advances our mission"**, common terminology with
    leadership) — client-side only (`required` attributes), no new DB constraints.
  - `supabase/tests/30_sheet_fields_test.sql` updated for `sign_on_methods`; `supabase/seed/test_contracts.sql`
    and both `tests/ui/*.mjs` scripts updated to match. `01_contracts_schema.sql`'s `contracts_parent_idx`
    creation had to be guarded (it unconditionally referenced the now-dropped `parent_id`, which broke that
    file's by-hand re-runnability once 08 has run) — the only edit made to an already-run migration file, and
    it stays a no-op change for anyone who already ran 01.
  - Verified end-to-end this session (no local PostgreSQL on this machine, so via a disposable
    `postgres:16-alpine` Docker container, same approach as 2026-11-12's notification-requirements run): all
    migrations 01→08 run clean twice in a row in order (matching `run.sh`'s own double-run check), the full
    `supabase/tests/*_test.sql` suite passes, `npm run build` succeeds, and both `tests/ui/pages.mjs` and
    `tests/ui/sheet_fields.mjs` pass against a local Vite dev server (one pre-existing, unrelated failure in
    `pages.mjs` — the `?decide=1` deep link — reproduces identically on the pre-change code, so it's not new).
    **Migrations 07 and 08 have both been run against the real Supabase project (2026-11-12).** The app
    changes on this branch can now be merged without a migration-ordering gap.
- **Built (2026-11-12):** signatory history — `09_responsible_party_history.sql`. The user flagged that
  for a long-running contract, the original signatory shown next to "Initial contract date" is often not
  who's responsible now; decided with the user:
  - Scope is the **signatory only** (not `department_manager`, which stays a single current field).
  - New `contract_signatories` table: `contract_id`, `name`, `email`, `start_date` ("effective as of"),
    `note`, `created_by`/`created_at`. Editable/deletable by anyone who can edit the contract (same as
    milestones/links), not append-only like documents. Audited like every other contract child table.
  - "Current" = whichever row's `start_date` is the latest one on or before today (ties broken by
    `created_at`). `contracts.signatory_name`/`signatory_email` stay as a **synced cache** of that row —
    kept current by a trigger on inserts/updates/deletes — so `contract_missing_attrs()` and the reminder
    queries in `07_notification_requirements.sql` needed **no changes at all**.
  - A future-dated entry can't retroactively flip the cache at write time; `contract_resync_signatories()`
    catches that once a day (called from `contract-reminders`, right before `contract_reminders_due()` —
    best-effort, a failure there doesn't block real reminders from sending).
  - Backfills a Day-1 history row for every contract that already has a `signatory_name` (dated to its
    initial contract date, else effective date, else when the record was added).
  - UI: new "Signatory history" panel on the contract detail page (`SignatoriesPanel` in
    `src/components/contract/panels.jsx`), listing entries with a "Current" badge and an add-entry form.
    The contract form's Signatory name/email fields are now **editable only when creating** a contract
    (seed the first history row on save); once a contract exists they're disabled, with a hint pointing
    at the history panel — editing them directly would silently fight with whatever the history table
    computes as current. The detail page's "Initial contract date" and "Current signatory" are now two
    separate rows (previously shown together as "`date` · signed by `name`", which is exactly the
    confusion that prompted this).
  - Covered by new `supabase/tests/70_signatory_history_test.sql` (current-row selection, the future-
    dated-entry and same-date tie-break edge cases, the missing-data check still firing once there's no
    current entry, RLS, and the audit trail). `supabase/tests/run.sh` and the two `tests/ui/*.mjs` scripts
    updated to match; the Edge Function e2e test's mock fetch handles the new resync RPC call (not run
    itself this session — no Deno on this machine — but it's a small, low-risk addition reviewed by hand).
  - Verified the same way as 08 above (disposable `postgres:16-alpine` container): migrations 01→09 run
    clean twice in a row, the full SQL suite passes, `npm run build` succeeds, and
    `tests/ui/{pages,sheet_fields,users}.mjs` all pass (same one pre-existing `pages.mjs` failure as noted
    above, still unrelated). **Migration 09 has been run against the real Supabase project (2026-11-13;
    this line previously said otherwise — corrected 2026-11-13).**
- **Built (2026-11-13):** the sidebar's nested Admin submenu could never be opened by click while the
  sidebar was collapsed (the heading had no route to navigate to, and the expand-toggle was disabled
  while collapsed). Replaced with a single `/admin` sidebar link plus a horizontal `AdminTabs` bar
  (`src/components/AdminTabs.jsx`) on each admin page, matching license-manager's `/admin` layout —
  `Page` in `src/components/ui.jsx` gained a `tabs` prop rendered above the title. `/admin` itself
  redirects admins to `/admin/settings` and auditors (who can't see Settings) to `/admin/audit`, so
  auditors don't get bounced out of the admin area entirely. Covered by two new cases in
  `tests/ui/pages.mjs`.
- **Built (2026-11-17):** two small fixes on `notification-requirements`:
  - The seeded contract type "Vendor contract / MSA" conflated two separate things — MSA is the
    `custom_msa` flag + an attached `msa`-role document (migration 06), not a contract type of its
    own. Renamed to plain "Vendor contract" via `10_rename_vendor_type.sql`; `01_contracts_schema.sql`'s
    insert was updated to match (a no-op for anyone who already ran 01, same precedent as 08's
    `parent_id` guard edit). Updated every reference to the old name (`supabase/seed/test_contracts.sql`,
    `supabase/tests/20_security_test.sql`, `tests/ui/pages.mjs`, `run.sh`'s migration list).
  - The Edit contract form's section nav is now the same sticky left sidebar as the contract detail
    page (`SectionNav orientation="left"` in `src/pages/ContractForm.jsx`), instead of only the
    horizontal bar at the top.
  - Verified the same way as 08/09 above (disposable `postgres:16-alpine` container, Docker wasn't
    running so it was started first): migrations 01→10 run clean twice in a row, the full SQL suite
    passes (including the renamed-type references in `20_security_test.sql` and `30_sheet_fields_test.sql`),
    `npm run build` succeeds, and all three `tests/ui/*.mjs` suites pass (same pre-existing, unrelated
    `pages.mjs` `?decide=1` failure as before). **Migration 10 has not yet been run against the real
    Supabase project** — do that before merging this branch's app changes, per the usual migration-then-app
    ordering.
- **Built (2026-11-19):** visual refresh of the contract detail/edit/create pages, from a design review
  in a Claude Artifact canvas (not committed to this repo). `src/components/ui.jsx`'s `Card` gained an
  optional `icon` prop (small rounded chip, used throughout `ContractDetail.jsx`, `ContractForm.jsx` and
  `src/components/contract/panels.jsx`) and a new `KeyFacts` component (a stat-tile strip — status,
  vendor, annual amount, notice deadline — shown above the section nav on the detail page); `GroupHeading`
  groups related rows/fields inside one Card (e.g. "Term" vs "Notice & termination" under Dates & renewal).
  On `ContractForm.jsx`, re-grouped into **Basics / Financial / Dates and renewal / Administration / More**
  (Financial moved up to directly after Basics; "System and subscription" renamed **Administration**; Tags
  and Notes moved into a new **More** section) and several relabels: "Effective date" → **Start date**
  (also on the detail page's Dates & renewal card), "Signatory name/email" → **Signer / Signer email**,
  "Termination notice (days)" → **Termination notice period (days)** with a hint distinguishing it from
  the renewal notice period, Contract type now sits beside Vendor, Vendor contact (+ a new **Vendor
  email**, stored in `details` jsonb like `vendor_contact` already was — no migration) moved from the
  vendor-only "Vendor details" section into Basics so it applies to every contract kind, and Visibility's
  Standard/Restricted select became a plain **Restricted** checkbox.
  **Removed** (no longer settable through either form): Backup owner, Department manager + email, Contract
  length (years), Initial contract date, the free-text "Renewal notice terms (as written)" field, the
  per-contract reminders on/off toggle (reminders are now unconditionally on — `reminders_enabled: true`
  is sent on every save, which re-enables reminders for any contract that had them off), and the whole
  admin-only **Activation exception** section (`no_original_exception`/`no_original_reason` — admins can no
  longer grant, change the reason for or revoke this via the UI at all; `contracts_guard()` in
  `05_original_exception.sql` still enforces/honors it, so existing exceptions keep working, there's just no
  UI path to one any more). All of these are *omitted* from the save payload rather than sent as `null`, so
  an existing contract's current values for them survive being edited — they just can't be changed through
  the app from here on. This was a deliberate, explicit call (confirmed with the user after flagging the
  consequences) to carry the mockup's removals into the real app, not an oversight.
  Two things the mockup asked for were **not** carried over, because the mockup never modeled contract
  types other than "vendor" and the real form does: Internal owner and Restricted stayed in Basics instead
  of moving into Administration, because Administration only renders for `kind === 'vendor' || 'other'` —
  moving them there would have made Internal owner (required for every contract) and Restricted (a
  universal access-control field) impossible to set at all for MOU/SOW contracts. Also keeping
  `sensitivity` defaulting to `'standard'` rather than flipping the New-contract default to `'restricted'`
  (a later mockup comment asked for the latter) — defaulting every new contract org-wide to restricted
  visibility is a real access-control posture change, not a layout tweak, so it needs a deliberate decision
  rather than inheriting it from a UI-review comment thread. `evergreen` stayed a separate real checkbox
  (just repositioned next to Renewal type) rather than being folded into the `renewal_type` enum, since
  `contracts_guard()` and the notification-requirements logic both read the real `evergreen` column
  directly and `renewal_type` is purely descriptive — merging them would have been a schema change, not a
  restyle.
  `tests/ui/sheet_fields.mjs` updated to match (relabeled locators, new assertions that the removed fields
  are genuinely absent from both the Playwright DOM and the save payload, and that `reminders_enabled` is
  always `true`). Verified this session: `npm run build` succeeds, and `tests/ui/{pages,sheet_fields,users}.mjs`
  all pass against a local Vite dev server (same one pre-existing, unrelated `pages.mjs` `?decide=1` failure
  noted in earlier entries above). No `supabase/contracts/` migration was needed — nothing here touched the
  schema.
- **Built (2026-11-23):** switched sign-in from Google OAuth to SAML SSO (`supabase.auth.signInWithSSO`),
  **this app only** — license-manager (and helpdesk) are a separate move, deliberately done one at a time so
  each can be tested on its own; license-manager is keeping Google alongside SSO for its own existing users,
  contract-repository is SSO-only. The SAML IdP itself was already registered on the shared Supabase project
  (coordinated with the license-manager session, not done here) — nothing to register for this app.
  `src/lib/auth.js`'s `signInWithGoogle()` → `signInWithSSO()`, reading the provider UUID from the new
  `VITE_SSO_PROVIDER_ID` env var (same name/value as license-manager's, for consistency — not shared at
  runtime, just convention); `src/pages/Home.jsx`'s Google button replaced with a generic SSO button (no
  provider-branded icon, since this account's identity isn't tied to Google any more); `AuthCallback.jsx`'s
  comment updated (behavior unchanged — it's provider-agnostic, just waits for a session). `resolveProfile()`
  and `AuthContext.jsx` needed no changes; they were already provider-agnostic.
  Checked the shared `resolve_profile()` RPC (in license-manager's `supabase/schema.sql`, which this repo's
  SQL tests and this live project both depend on but never edits) before touching anything: it already derives
  identity only from `auth.uid()`/`auth.users` and ignores the legacy `p_supabase_user_id`/`p_email`
  parameters — a client-supplied-identity hole that's documented there as already fixed. No `auth.users`
  provisioning trigger exists either; profile creation is solely through that RPC. Neither needed any action
  here.
  **Not done, and worth knowing about before this goes live:** existing contract-repository users (shared
  with license-manager) still have a Google identity on their account; Supabase won't let a new SAML identity
  attach to an email that already has one, so a user's first SSO sign-in can fail outright unless their old
  Google identity is cleared first. No bulk migration step has been written or run — right now this only
  changes which button the sign-in page shows and which code path runs; it hasn't been tried against a real
  existing user yet. `VITE_SSO_PROVIDER_ID` also still needs to be set in Amplify's environment for the
  deployed site, not just local `.env`.
  `SETUP.md`, `README.md` and this file's Architecture section updated to match; `.env.example` gained
  `VITE_SSO_PROVIDER_ID`. Verified: `npm run build` succeeds, `tests/ui/{pages,sheet_fields,users}.mjs` all
  pass (same pre-existing `?decide=1` failure, unrelated) — none of them exercise the sign-in button itself,
  since they all mock an already-authenticated session.
- **Open decision:** whether the sheet's "Other Systems" tab (many rows with no contract) is imported, and as
  what — on hold (2026-10-08), revisit later.
- **Planned, not built:** import of the existing tracking sheet (it is confidential — don't commit it);
  Phase 2/3 items in `docs/REQUIREMENTS.md` (CSV export, link health checks, integrity re-verification, search).
- Known follow-ups: license-manager's browser-composed emails still let any signed-in user send arbitrary email
  through `send-email` (noted in PR #22); GitHub Actions show a Node 20 deprecation warning
  (`actions/checkout@v4`, `supabase/setup-cli@v1`) — harmless for now.
- Data heads-up from the sheet: Zoom's next renewal (10/1/2026) is already past and Freshworks' cancel-by date
  (9/11/2026) has passed; expect "passed deadline" reminders when those are entered.
