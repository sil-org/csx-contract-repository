# Setup

This app runs in the **same Supabase project as license-manager** and signs in the same way, so
most of the usual "new app" setup is already done. Do these in order.

## 1. Supabase (existing project — no new project, no new Google OAuth client)

1. **Run the schema.** SQL Editor → new query → paste and run
   [`supabase/contracts/01_contracts_schema.sql`](supabase/contracts/01_contracts_schema.sql).
   It requires license-manager's auth kernel (`profiles`, `linked_accounts`, `current_profile_id()`),
   which is already there. It only creates `contract_`-prefixed objects and is safe to re-run.
   Then run [`supabase/contracts/03_user_search.sql`](supabase/contracts/03_user_search.sql) the same way. It makes
   the Users page list only people who have a role and adds a search for adding someone (the shared project
   has thousands of profiles, so they are never all loaded at once).
   Then run [`supabase/contracts/04_sheet_fields.sql`](supabase/contracts/04_sheet_fields.sql), which adds the fields
   needed to hold everything in the existing Software Subscriptions tracking sheet (the header of that file maps every
   sheet column to its field).
   Then run [`supabase/contracts/05_original_exception.sql`](supabase/contracts/05_original_exception.sql), which adds
   the admin-only "original not on file" activation exception.
   Then run [`supabase/contracts/06_signatory_and_custom_msa.sql`](supabase/contracts/06_signatory_and_custom_msa.sql),
   which adds signatory name/email, department manager email, contract length, and the custom-MSA
   attach-before-activating rule (the header of that file maps every new data element to its field).
   Run each migration **before** the app update that uses it goes live. Re-running any of them is safe.
2. **Allow this app's URLs.** Authentication → URL Configuration → add to **Redirect URLs**:
   `https://YOUR_DOMAIN/auth/callback` and `http://localhost:5173/auth/callback`.
   Leave **Site URL** alone — it belongs to license-manager.
3. **Google Cloud** (the existing OAuth client): add `https://YOUR_DOMAIN` (and `http://localhost:5173`)
   under *Authorised JavaScript origins*. The redirect URI (Supabase's `/auth/v1/callback`) is unchanged.
4. **Make yourself the first contract admin.** Sign in to the app once (you'll land on "Access needed"), then:
   ```sql
   insert into contract_roles (profile_id, role)
   select id, 'admin' from profiles where primary_email = 'your-email@sil.org';
   ```
   Everyone else is assigned a role from **Admin → Users & roles**: search for the person under *Add a person*
   (they appear once they have signed in to any SIL app or been imported into the license manager) and pick a role. License-manager admins get
   **no** contract access automatically.

## 2. S3 bucket for the documents

Executed originals live in a private S3 bucket with versioning + Object Lock, never in Git.

1. With an AWS user who can create buckets:
   ```bash
   BUCKET=your-unique-bucket-name REGION=us-east-1 \
   ALLOWED_ORIGINS='https://YOUR_DOMAIN,http://localhost:5173' ./infra/create-bucket.sh
   ```
   Object Lock starts in **governance** mode with a placeholder 7-year retention — see the comments in the
   script. Don't move to compliance mode until the retention policy is confirmed (it can't be undone).
2. Create a limited IAM user from [`infra/iam-policy.json`](infra/iam-policy.json) (replace `BUCKET_NAME`).
   It can upload and read, and is explicitly denied every delete and every way of weakening the lock.
   Create an access key for it.

## 3. Edge Function secrets

```bash
supabase secrets set --project-ref <project-ref> \
  CONTRACTS_AWS_ACCESS_KEY_ID=… CONTRACTS_AWS_SECRET_ACCESS_KEY=… CONTRACTS_AWS_REGION=us-east-1 CONTRACTS_BUCKET=your-unique-bucket-name \
  CONTRACTS_ALLOWED_ORIGINS='https://YOUR_DOMAIN,http://localhost:5173' \
  CONTRACTS_APP_ORIGIN='https://YOUR_DOMAIN'
```
These are `CONTRACTS_`-prefixed because secrets are project-wide (shared with license-manager) —
a generic name like `AWS_REGION` could collide with another app's secret. `CRON_SECRET` is the one
exception: it's already set and deliberately shared with license-manager's scheduled functions — don't change it.
Full table: [`supabase/functions/README.md`](supabase/functions/README.md).

## 4. Email

Reminders send through license-manager's `send-email` function with `app: 'contracts'` (sender
`Contract Repository <contracts@em.sil.org>`). That needs the updated `send-email` — see
[`docs/send-email-fix.md`](docs/send-email-fix.md). `em.sil.org` is already verified in Resend, so no
new domain or DNS is needed. Until it's deployed, reminders log as *failed* (visible under
Admin → Reminder log) and retry daily — nothing is lost.

## 5. GitHub secrets (this repo)

Settings → Secrets and variables → Actions: `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`
(same values as license-manager). The workflow deploys **only** `contract-documents` and
`contract-reminders` — never `send-email`.

## 6. Amplify Hosting

AWS Amplify → New app → Host web app → GitHub → this repo, branch `main` (`amplify.yml` is picked up).
Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (same as license-manager's).
Rewrites and redirects: `{ "source": "/<*>", "status": "404-200", "target": "/index.html" }`.
Optional custom domain under Domain management.

## 7. Schedule the daily reminders

After the functions are deployed, run
[`supabase/contracts/02_schedule_reminders.sql`](supabase/contracts/02_schedule_reminders.sql) in the SQL Editor.
Then dry-run it (lists what *would* send, sends nothing):
```bash
curl -s -X POST https://<project-ref>.supabase.co/functions/v1/contract-reminders \
  -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' -d '{"dry_run": true}'
```

## 8. First-run checklist

- [ ] Sign in → "Access needed" → run the admin SQL above → reload → you see Coming due.
- [ ] Admin → Users & roles lists license-manager users; give a colleague *Viewer* and confirm they can't see Admin.
- [ ] New contract (draft) → upload a PDF as **Original (executed)** → the upload succeeds
      *(this is the first real S3 round-trip: if it fails with a CORS or checksum message, check steps 2–3)*.
- [ ] Download it back; open **Admin → Audit log** and see the download recorded.
- [ ] Set the contract Active, give it a notice deadline ~30 days out; run the dry-run above and see it listed.

## 9. Local development

```bash
cp .env.example .env     # same Supabase URL/anon key as license-manager
npm install
npm run dev              # http://localhost:5173
```

### Tests

The date/reminder logic and the security rules live in Postgres and are tested there against a throwaway
local database (needs PostgreSQL installed; no Docker, no Supabase account):

```bash
supabase/tests/run.sh path/to/license-manager/supabase/schema.sql   # the shared auth kernel
```
This applies the schema twice (proving it's re-runnable) and runs `supabase/tests/*_test.sql`:
reminder timing around every boundary, once-per-cycle behaviour, row-level security per role,
immutable documents, append-only audit log, and that a license-manager admin has no contract access.
