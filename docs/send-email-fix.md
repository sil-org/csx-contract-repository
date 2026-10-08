# Change needed in license-manager's `send-email`

This app sends reminder email through license-manager's `send-email` Edge Function (same Supabase
project; one function, one Resend key, one verified domain). Two changes are needed there. They are
prepared as a branch on `kode-monki/license-manager` — `claude/send-email-auth-and-per-app-sender` — and are
**not deployed until that branch is merged to `main`** (its workflow deploys on push to `main`).

## 1. Security: the function never checked who was calling

`send-email` is deployed with `--no-verify-jwt`, and its only check was that an `Authorization` header
*exists*. Any value passes, so anyone who knows the function URL can make it send arbitrary email as
"License Manager <license_manager@em.sil.org>" (and it logs nothing identifying the caller).

**Fix:** accept only
- the project's service-role key or `CRON_SECRET` (server-to-server callers: the scheduled reminder
  functions in both apps), or
- a valid signed-in user's Supabase access token (the license-manager browser app).

Everything else gets a 401. All of license-manager's existing callers already send one of these.

**Residual risk (not changed here):** license-manager's browser app composes email bodies and recipients
client-side, so any signed-in SIL user can still call the function with arbitrary content. Closing that
properly means moving each email's composition server-side or restricting recipients; worth a follow-up.

## 2. Per-app sender

The request may include `app`. `licenses` (the default when omitted, so existing callers are unchanged)
sends as before. `contracts` sends as `Contract Repository <contracts@em.sil.org>`. Non-default apps can
only be used by server-to-server callers, and the sender is chosen from a fixed list on the server —
callers can never supply their own `from` address.
