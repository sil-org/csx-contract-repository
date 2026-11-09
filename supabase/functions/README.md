# Edge Functions

This app's functions deploy to the **same Supabase project as license-manager**.
The deploy workflow names them explicitly so it can never overwrite `send-email`
(owned by license-manager).

| Function | Purpose | Called by | Auth |
|---|---|---|---|
| `contract-documents` | Issues short-lived S3 upload/download URLs; registers uploads (verifies S3 checksum + version) | Browser | Supabase user token, then RLS-equivalent checks |
| `contract-reminders` | Sends due reminders, logs outcome | `pg_cron` daily (`supabase/contracts/02_schedule_reminders.sql`) | `CRON_SECRET` bearer |

Both are deployed with `--no-verify-jwt` (this project uses the newer
`sb_publishable_...` key format, which the platform JWT gate rejects — see
license-manager's `supabase/functions/README.md`). Authentication is done inside each function.

## Secrets (`supabase secrets set ...`)

All of these (other than `CRON_SECRET`, deliberately shared) are `CONTRACTS_`-prefixed:
secrets are project-wide in this shared Supabase project, so a generic name like `AWS_REGION`
would collide with (or get silently overwritten by) another app's secret of the same name.

| Secret | Used by | Notes |
|---|---|---|
| `CONTRACTS_AWS_ACCESS_KEY_ID`, `CONTRACTS_AWS_SECRET_ACCESS_KEY`, `CONTRACTS_AWS_REGION` | contract-documents | IAM user from `infra/iam-policy.json` — no delete permissions |
| `CONTRACTS_BUCKET` | contract-documents | S3 bucket name |
| `CONTRACTS_ALLOWED_ORIGINS` | contract-documents | e.g. `https://contracts.sil.org,http://localhost:5173` |
| `CONTRACTS_APP_ORIGIN` | contract-reminders | e.g. `https://contracts.sil.org` (links in emails) |
| `CRON_SECRET` | contract-reminders | **Already set** for license-manager; same value, same Vault entry |

## Dependencies on license-manager

`contract-reminders` sends mail through license-manager's `send-email` with
`app: 'contracts'`, so that function must be a version that supports per-app senders
and `CRON_SECRET` auth (see `docs/send-email-fix.md`). Until it is deployed, reminders
will log as `failed` (visible to admins) and retry daily.

## Tests

- SQL (due-date logic, row-level security): `supabase/tests/run.sh` — see SETUP.md.
- `contract-reminders` handler (auth, composing, retry, logging), with the database and `send-email` mocked:
  `deno run -A --no-check supabase/tests/functions/contract_reminders_e2e.ts`
- Both functions type-check with `deno check` (run it from a copy outside this repo, or with
  `--node-modules-dir=auto`, since this repo's `package.json` changes how Deno resolves `npm:` imports).
