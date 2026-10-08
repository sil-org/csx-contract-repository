# Contract Repository — Requirements Specification

**Status:** Draft v0.3 · 2026-10-08
**Owner:** Kate Brenner
**Purpose:** A GitHub-hosted, IDP-authenticated repository of record for organizational agreements (MOUs, SOWs, vendor contracts), with preserved original copies and deadline reminders.

---

## 1. Scope

### 1.1 In scope
- Storing and indexing executed agreements and their supporting documents
- Preserving an **original, unaltered copy** of every executed agreement
- Optional link to a working copy (e.g., Google Drive)
- Structured metadata, search, and filtering
- Reminders for renewal, expiration, notice deadlines, and other dated obligations
- Role-based access via the organization's identity provider (IDP)
- Audit trail of who did what

### 1.2 Explicitly out of scope
- **Not a replacement for, or addition to, DocuSign** (or any e-signature tool). No drafting, redlining, routing for signature, or signature capture. Signing happens elsewhere; this system receives the signed result.
- Contract authoring/templates, negotiation workflow, AI clause extraction, CRM/ERP integration (candidates for later; see §10).

### 1.3 Contract types at launch
| Type | Notes |
|---|---|
| Memorandum of Understanding (MOU) | Often non-binding or partly binding; usually precedes a definitive agreement |
| Statement of Work (SOW) | Project-level; usually sits under a parent MSA |
| Vendor contract (incl. MSA) | Framework or standalone; most likely to auto-renew |
| Other | Catch-all (NDA, grant agreement, lease, etc.); type list must be admin-extensible |

---

## 2. Users and roles

| Role | Can do |
|---|---|
| **Viewer** | Search and view contracts they are granted access to |
| **Contributor** | Add contracts and metadata, upload files, edit contracts they own |
| **Contract owner** | The named person accountable for a contract; receives its reminders; can edit it |
| **Admin** | Manage users/roles, contract types, reminder defaults, legal holds, retention |
| **Auditor** (read-only) | View everything including audit log; cannot edit |

Requirements:
- **R-U1** Every contract has exactly one named internal owner and an optional backup owner. Reminders cannot be enabled on a contract with no owner.
- **R-U2** Roles are assigned by Admins in an in-app Admin → Users screen (as in the license manager). Everyone who signs in with an organization account starts with no contract access until an Admin assigns a role.
- **R-U3** Per-contract restriction: a contract can be marked *Restricted* so only the owner, named users, and Admins/Auditors can see it (HR, legal, or sensitive vendor matters).

---

## 3. Document storage

This is the section the "people move or delete things" concern drives.

- **R-D1 Original copy is always stored.** Every contract record must have at least one uploaded file designated **Original (executed)**. A record cannot be set to *Active* without it.
- **R-D2 Immutable originals.** Once designated, the original file cannot be overwritten or deleted by normal users. Replacement is only by uploading a new file as a **new version**; prior versions are retained. Deletion only by Admin, only after retention expiry and with no legal hold, and logged.
- **R-D3 Integrity check.** On upload, compute and store a SHA-256 hash. The system can re-verify stored files against their hash on a schedule and alert Admins on mismatch.
- **R-D4 Drive links are optional and secondary.** A record may carry one or more external links (Google Drive, etc.) labelled *working copy*. Links are convenience only; the stored original is the authority.
- **R-D5 Link health check.** Periodically verify that external links still resolve; flag broken or access-denied links to the owner. (This catches moved/deleted Drive files.)
- **R-D6 Supporting documents.** Allow multiple attachments per contract with a document role: Original (executed), Amendment, Exhibit/Schedule, Correspondence, Other.
- **R-D7 Versioning.** Keep full version history per document; show who uploaded each, when, and why (required change note).
- **R-D8 Accepted formats.** PDF required for executed originals; also allow DOCX, XLSX, images. Size limit to be set (suggest 50 MB/file). Virus scanning on upload (Phase 2; e.g., GuardDuty Malware Protection for S3).
- **R-D9 Storage backend.** Binary files must **not** be committed to the Git repository (Git is a poor fit for large binaries and cannot enforce immutability or access control). Originals are stored in a private **Amazon S3** bucket with public access blocked, encryption on, **versioning and Object Lock** enabled (see §8). Object Lock starts in *governance* mode; moving to *compliance* mode waits on confirmed retention periods (§11).
- **R-D10 Backup and restore.** Automated backups of both database and files, with a documented, tested restore.

---

## 4. Metadata

Define fields **before** bulk entry; inconsistent classification is hard to fix once hundreds of records exist.

### 4.1 Core fields (all contract types)
| Field | Required | Notes |
|---|---|---|
| Title | Yes | |
| Contract type | Yes | MOU / SOW / Vendor / Other |
| Counterparty (name) | Yes | Use a shared counterparty list to avoid duplicates |
| Internal owner / backup owner | Yes | |
| Department / program | Yes | |
| Status | Yes | Draft, Active, Expired, Terminated, Superseded, Completed |
| Effective date | Yes | |
| Expiration / end date | Yes (or "evergreen") | |
| Binding status | Yes | Non-binding / Partly binding / Binding |
| Signed date | Yes | |
| Governing law / jurisdiction | No | |
| Confidentiality / sensitivity | Yes | Standard / Restricted |
| Tags | No | Free-form, with suggested vocabulary |
| Notes | No | |

### 4.2 Renewal and notice fields
| Field | Notes |
|---|---|
| Renewal type | None / Automatic / Option to renew / Manual (mutual consent) |
| Renewal term | e.g., 12 months |
| **Notice period (days)** | Days before expiry that notice of non-renewal/termination is due |
| **Notice deadline (computed)** | Expiration date minus notice period; the date that actually protects the organization |
| Termination for convenience? | Yes/No + notice days |

### 4.3 Financial fields (vendor, SOW)
Contract value, currency, payment terms, billing frequency, budget code / cost center.

### 4.4 Relationships
- **R-M1** An SOW can reference a **parent agreement** (MSA). View a parent and see all child SOWs.
- **R-M2** Amendments link to the contract they amend; the record shows the current effective terms and the amendment history.
- **R-M3** Contracts can be marked **Superseded by** another contract.

### 4.5 Type-specific fields
- **MOU:** expected next step (e.g., definitive agreement), target date, list of binding clauses (confidentiality, exclusivity), purpose.
- **SOW:** project name, deliverables summary, milestones (date + description), parent MSA.
- **Vendor:** vendor contact, SLA summary, insurance/compliance certificate expiry, data-protection terms present (Y/N).

### 4.6 Provisions checklist (optional)
Yes/No flags: confidentiality, auto-renewal, assignment consent, indemnification, limitation of liability, data protection, termination for convenience, non-solicit.

---

## 5. Reminders

- **R-R1 Date-driven reminders.** Generate reminders from dates on the record: notice deadline, expiration, and any milestone/obligation date (SOW milestones, certificate expiries, payment milestones, MOU follow-up dates).
- **R-R2 Default schedule, overridable per contract.** Suggested default for renewal-bearing contracts:
  1. **Planning reminder** — 120 days before notice deadline
  2. **Decision reminder** — 60 days before notice deadline (decide: renew / renegotiate / terminate)
  3. **Final reminder** — 14 days before notice deadline
  4. **Escalation** — if no recorded decision by 7 days before the deadline, notify backup owner and a designated escalation contact
  Lead times must be admin-configurable.
- **R-R3 Reminders anchor to the notice deadline, not the expiration date.** Reminding on the expiration date is too late for auto-renewing contracts.
- **R-R4 Each reminder states the next action** (renew / renegotiate / terminate / confirm no action) and links to the record.
- **R-R5 Recording a decision.** Owner can record the decision and rationale from the reminder; recording a decision stops further escalation for that cycle.
- **R-R6 Channels.** Email at minimum (to owner and backup). Optional: Slack/Teams, calendar (.ics) event. Channel list is an open question (§11).
- **R-R7 Recurring contracts.** When a contract renews, the owner updates the dates and the next cycle's reminders are generated; an auto-renewal that nobody acted on must be flagged ("passed notice deadline — renewed automatically?").
- **R-R8 Dashboard.** "Coming due" view: contracts by upcoming notice deadline/expiry in 30/60/90/180 days, overdue items, contracts missing an owner or a decision.
- **R-R9 Digest.** Optional weekly digest per owner and a monthly summary for Admins.
- **R-R10 Reminder reliability.** Failed sends are retried and surfaced to Admins; reminder history is logged.

---

## 6. Search, browse, reporting

- **R-S1** Filter/sort by type, status, counterparty, owner, department, tag, date ranges, and value.
- **R-S2** Keyword search across metadata; full-text search of PDF contents (OCR for scanned PDFs is a stretch goal).
- **R-S3** Saved views (e.g., "My contracts expiring in 90 days").
- **R-S4** CSV export of the filtered list (permission-controlled and logged).
- **R-S5** Reports: upcoming deadlines, contracts by status/type, spend by vendor (where value is recorded), contracts missing required fields.

---

## 7. Authentication and access

- **R-A1 Sign-in only via the organization's IDP.** Google Workspace SSO through Supabase Auth, restricted to organization (sil.org) accounts using an Internal OAuth consent screen, as in `sil-app-template`/`license-manager`. No local passwords.
- **R-A2** Deprovisioning a person in Google Workspace blocks their sign-in automatically; Admins also deactivate their profile and reassign any contracts they own.
- **R-A3** Session timeout and MFA enforced by the IDP policy.
- **R-A4** File downloads use short-lived signed URLs issued by an Edge Function after an access check, never public links. The function's AWS credentials allow upload and read only, with no delete.
- **R-A5** Least privilege: a new user has no access to contracts until an Admin assigns a role.

---

## 8. Hosting and architecture options

"Lives on GitHub" needs a decision, because GitHub hosts code, not a secured document store. Options:

| Option | Description | Pros | Cons |
|---|---|---|---|
| **A. GitHub-hosted code + managed backend** (recommended) | Repo holds the app code, config, docs, CI/CD (GitHub Actions); data in a managed database and versioned object storage; reminders via scheduled job | Meets immutability, access control, and reminder needs | More moving parts |
| **B. Contracts as files in a private GitHub repo** | Metadata as YAML/JSON beside PDFs; Actions send reminders | Simple, free, full history | No per-contract access control, large binaries, deletable by anyone with write access, history can be rewritten — conflicts with R-D2/R-U3 |
| **C. Buy an off-the-shelf repository** | e.g., a lightweight CLM | Fastest | Cost; outside "build it ourselves" intent |

**Decision (2026-10-08): Option A**, built on `sil-app-template` (the same stack as `license-manager`):
- Frontend: React + Vite + Tailwind on AWS Amplify Hosting, connected to this repo (builds on push to `main`).
- Backend: the **same Supabase project as `license-manager`** (Postgres + Auth + RLS). Business rules live in Postgres functions; migrations are numbered SQL files.
  - Authentication is shared: same Google OAuth client, same `profiles` / `linked_accounts` tables, same sign-in flow. This app only adds its own Site URL and redirect URL to the project's allowed list.
  - Contract tables are prefixed `contract_` (e.g., `contract_audit_log`) because `audit_log`, `email_log`, `is_admin()` and several enums already belong to the license manager. Contract migrations live in their own folder and never alter license-manager tables or types.
  - Because the database is shared, an RLS mistake in one app can expose the other's data. RLS policies for contract tables are tested before release.
- Documents: S3 with versioning and Object Lock (to my knowledge Supabase Storage has neither, so it is not used for originals). The database stores each document's S3 key, version ID, and SHA-256 hash.
- Reminders: a daily `pg_cron` job calls an Edge Function protected by a `CRON_SECRET` (kept in Supabase Vault), which sends through the `send-email` function (Resend).
- Edge Functions deploy through GitHub Actions. `send-email` currently belongs to `license-manager` (sender `license_manager@em.sil.org`); this repo must not redeploy a competing copy (see §11 #12).

Notes:
- Object storage must support **versioning and object lock/WORM** to enforce R-D2.
- Secrets and credentials are never committed; use GitHub/host secrets.

---

## 9. Non-functional requirements

- **Security:** encryption in transit and at rest; malware scanning; access logging; dependency and secret scanning in CI.
- **Audit log (immutable, append-only):** records who viewed/downloaded (for Restricted contracts at minimum), uploaded, edited fields (old → new value), changed status, changed roles, recorded decisions, deleted. Retained for the same period as the contract record.
- **Retention:** per-type retention schedule, with the clock starting from a trigger (typically expiry or termination) rather than signing. **Legal hold** flag (Admin only) suspends all deletion until formally lifted. Actual periods to be confirmed with counsel/records policy, not assumed.
- **Privacy / compliance:** counterparty personal data minimized; applicable privacy regulations to be identified (open question).
- **Availability:** business-hours availability is sufficient; reminders must run daily without manual action.
- **Usability:** a contributor can add a contract (upload + required metadata) in under 5 minutes; mobile-friendly viewing.
- **Accessibility:** WCAG 2.1 AA.
- **Maintainability:** documented setup, infrastructure as code where practical, automated tests for date/reminder logic (the highest-risk code).
- **Migration:** bulk import of existing contracts from a spreadsheet/CSV plus a file folder, with a validation report of missing/invalid fields.

---

## 10. Phasing

| Phase | Contents |
|---|---|
| **MVP** | IDP sign-in, roles, contract records with core + renewal metadata, original upload with hash, versioning, optional Drive link, email reminders (default schedule), "coming due" dashboard, audit log, backup |
| **Phase 2** | Link health checks, integrity re-verification, per-contract restriction, escalation, saved views/reports/CSV export, Slack/calendar reminders, bulk import |
| **Phase 3** | Full-text/OCR search, obligation/milestone tracking depth, retention automation and legal-hold workflow, optional integrations (finance, procurement) |

---

## 11. Open questions

1. ~~**Which IDP?**~~ **Resolved:** Google Workspace SSO via Supabase Auth, as in `license-manager`.
2. ~~**Hosting preference**~~ **Resolved:** Option A on Amplify + Supabase, with S3 for documents (§8). Data-residency constraints, if any, still to confirm.
3. **Who are the users and roughly how many contracts exist today?** (Sizes migration and search needs.)
4. **Escalation contact** for missed decisions. Proposed: the contract's backup owner, with an Admin-configured fallback address for contracts without one. Not blocking.
5. **Reminder channels:** email only for the MVP (agreed); Slack/Teams/calendar in Phase 2 if wanted.
6. **Retention periods and legal-hold process:** does the organization already have a records retention policy to adopt?
7. **Sensitivity:** do any contracts contain personal data or require restricted visibility by default?
8. **Counterparty list:** is there an existing vendor/partner master list to sync with?
9. **Are MOUs reviewed for binding status by legal,** or should the app just record the drafted position?
10. **Repo name:** currently `contract-repository-` (trailing hyphen); rename to `contract-repository` (pending).
12. **Shared project housekeeping.** (a) **Decided:** contract roles are separate from the license manager's. A `contract_roles` table keyed to `profiles(id)` holds Viewer / Contributor / Auditor / Admin; license-manager admins get no contract access unless granted, and the shared `user_role` enum is untouched. The first contract Admin is seeded by SQL, like the license manager's first admin. (b) `send-email`: generalize the existing function (sender name/address per app) rather than deploying a second copy. (c) Shared `cron_secret` in Vault is reused.
11. **Object Lock mode:** start in governance mode; switch to compliance only after retention periods are confirmed (irreversible).

---

## 12. Research basis and caveats

This spec combines the requested features with recurring guidance from contract-management sources. Most are vendor blogs, so treat product claims with caution; retention periods, evidentiary standards, and enforceability questions need counsel, not this document.

- Core features (metadata, alerts, audit trail, role-based access, versioning): [Merlin Sourcing](https://merlinsourcing.com/?p=21070), [Volody](https://www.volody.com/resource/what-is-a-contract-repository-system), [Hyperstart](https://www.hyperstart.com/blog/contract-repository/), [Contracts365](https://www.contracts365.com/blog/four-essential-features-of-an-effective-contract-repository), [Concord](https://www.concord.app/contract-repository-software/)
- Metadata, owners, and renewal/notice tracking: [ContractSafe](https://www.contractsafe.com/blog/contract-repository-best-practices), [Yousign](https://yousign.com/blog/contract-repository-best-practices-centralizing-searching-agreements), [Aline](https://www.aline.co/post/contract-repository-management-best-practices), [ContractSafe standard fields](https://www.contractsafe.com/support/standard-fields-in-contractsafe)
- Retention and legal holds: [Concord](https://www.concord.app/blog/contract-retention-policy), [Baker Donelson](https://bakerdonelson.com/What-Is-a-Legal-Hold-How-Does-It-Differ-From-a-Records-Retention-Policy-and-Why-Is-It-Important-12-07-2012)
- MOU vs SOW vs MSA: [PandaDoc](https://www.pandadoc.com/blog/master-services-agreement-vs-statement-of-work/), [SpotDraft](https://www.spotdraft.com/blog/msa-vs-sow), [Sprintlaw](https://sprintlaw.co.uk/articles/mou-vs-contract/), [ChangeLab Solutions](https://changelabsolutions.org/sites/default/files/MOU-vs-Contracts_FINAL_20120117.pdf)
- Renewal tracking: [Legislate](https://www.legislate.ai/blog/contract-renewal-tracking-dates-notices-and-risk)

The immutability, hash-verification, and Drive link-health requirements (R-D2, R-D3, R-D5) are design recommendations responding to the stated concern about moved or deleted files; the sources on those topics were thin (mostly vendor and patent material).
