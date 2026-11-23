# Contract Repository

A repository of record for MOUs, SOWs, and vendor contracts: the executed original of every agreement is preserved unaltered, and the people responsible are reminded before notice deadlines pass. **Not** a replacement for, or addition to, e-signature tools such as DocuSign — it receives the signed result.

Built on [`sil-app-template`](https://github.com/kode-monki/sil-app-template) and sharing the **Supabase project and sign-in with `license-manager`**.

- **Requirements:** [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) (v0.3)
- **Setup:** [SETUP.md](SETUP.md)

## How it works

| Layer | Choice |
|---|---|
| Frontend | React + Vite + Tailwind → AWS Amplify Hosting (builds on push to `main`) |
| Sign-in | SAML SSO (SIL staff) via the shared Supabase Auth — same provider as license-manager, which still offers Google alongside it for now |
| Data + rules | Supabase Postgres. All access control is row-level security; roles live in `contract_roles`, **separate from license-manager's roles** |
| Documents | Private **S3** bucket with versioning + Object Lock; the browser uploads/downloads with short-lived signed URLs from the `contract-documents` Edge Function. Postgres stores the index, SHA-256 and S3 version of each file |
| Reminders | Daily `pg_cron` → `contract-reminders` Edge Function → license-manager's `send-email`; what is due is computed in a tested SQL function |

## What's in this version (MVP)

Sign-in and roles (Viewer, Contributor, Auditor, Admin) · contract records with core, renewal, financial and
type-specific fields · notice deadline computed from expiry − notice period · executed-original upload with
hash, versioning and immutability · optional working-copy links · milestones · email reminders (planning,
decision, final, escalation, passed-deadline, milestone) with recorded decisions · "Coming due" dashboard ·
Restricted contracts · append-only audit log · admin screens (users, types, reminder settings, reminder log).

Phase 2 and 3 items (link health checks, scheduled integrity re-verification, saved views/CSV export,
bulk import, full-text/OCR search, retention and legal hold) are listed in the requirements.

## Repository layout

```
src/                       React app (pages/, components/, lib/)
supabase/contracts/        SQL migrations (01 – 06) — run in order in the Supabase SQL Editor
supabase/functions/        contract-documents, contract-reminders (+ _shared)
supabase/tests/            SQL tests + run.sh (throwaway local Postgres)
infra/                     S3 bucket script, CORS and least-privilege IAM policy
docs/                      requirements; send-email change for license-manager
```
