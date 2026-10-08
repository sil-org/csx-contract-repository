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
- `supabase/contracts/` — migrations **01–04**, run by hand in the Supabase SQL Editor, in order. All re-runnable.
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
  `CLAUDE.md`, `tests/ui/`). 04 has to be run in Supabase before merging.
- **Not done:** S3 bucket + IAM user + Supabase secrets (`AWS_*`, `CONTRACTS_BUCKET`, `ALLOWED_ORIGINS`,
  `CONTRACTS_APP_ORIGIN`) — uploads don't work until then, and first real upload is the first test of the
  presigned-checksum flow. The reminder dry run (`SETUP.md` step 7) hasn't been run against real data.
- **Open decisions:** (1) contracts without a PDF can't become Active, so most migrated rows stay drafts and get no
  reminders — proposed: admin-only "original not on file" exception with a required reason and a badge;
  (2) whether the sheet's "Other Systems" tab (many rows with no contract) is imported, and as what.
- **Planned, not built:** import of the existing tracking sheet (it is confidential — don't commit it);
  Phase 2/3 items in `docs/REQUIREMENTS.md` (CSV export, link health checks, integrity re-verification, search).
- Known follow-ups: license-manager's browser-composed emails still let any signed-in user send arbitrary email
  through `send-email` (noted in PR #22); GitHub Actions show a Node 20 deprecation warning
  (`actions/checkout@v4`, `supabase/setup-cli@v1`) — harmless for now.
- Data heads-up from the sheet: Zoom's next renewal (10/1/2026) is already past and Freshworks' cancel-by date
  (9/11/2026) has passed; expect "passed deadline" reminders when those are entered.
