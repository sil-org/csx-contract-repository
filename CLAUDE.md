# Contract Repository — working notes for Claude Code

Repository of record for MOUs, SOWs and vendor contracts: the executed original of every agreement is
kept unaltered, and the responsible people are reminded before notice deadlines. **Not** an e-signature
tool (no drafting, routing or signing). Requirements: `docs/REQUIREMENTS.md`. Setup: `SETUP.md`.

## Architecture (decisions already made — don't relitigate without asking)
- **Frontend:** React + Vite + Tailwind from `sil-app-template`, hosted on **AWS Amplify** (builds on push to `main`).
- **Backend:** the **same Supabase project as `license-manager`** — same Google sign-in, same `profiles` /
  `linked_accounts`. Because it is shared:
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
npm install && cp .env.example .env   # same VITE_SUPABASE_URL / ANON_KEY as license-manager
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
- **Branch `ccr-0927e7de-2f6zv7` has unmerged work:** migration `04_sheet_fields.sql` (+ form/detail fields,
  `CLAUDE.md`, `tests/ui/`), migration `05_original_exception.sql` — the admin-only "original not on
  file" exception (see below) — and now migration `06_signatory_and_custom_msa.sql`. All three have to be
  run in Supabase before merging.
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
- **Open decision:** whether the sheet's "Other Systems" tab (many rows with no contract) is imported, and as
  what — on hold (2026-10-08), revisit later.
- **Planned, not built:** import of the existing tracking sheet (it is confidential — don't commit it);
  Phase 2/3 items in `docs/REQUIREMENTS.md` (CSV export, link health checks, integrity re-verification, search).
- Known follow-ups: license-manager's browser-composed emails still let any signed-in user send arbitrary email
  through `send-email` (noted in PR #22); GitHub Actions show a Node 20 deprecation warning
  (`actions/checkout@v4`, `supabase/setup-cli@v1`) — harmless for now.
- Data heads-up from the sheet: Zoom's next renewal (10/1/2026) is already past and Freshworks' cancel-by date
  (9/11/2026) has passed; expect "passed deadline" reminders when those are entered.
