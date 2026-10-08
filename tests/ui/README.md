# Browser tests (no real Supabase needed)

Each script opens the app in headless Chromium against a **mocked** Supabase API (fake sign-in, fake
data), so they check that pages render, role-based redirects work, and forms send the right data.
They do not test real sign-in, real row-level security (that's `supabase/tests/`), or real S3.

```bash
npm install
npm install --no-save playwright-core
npx playwright-core install chromium        # once; or set CHROMIUM_PATH to an installed Chromium/Chrome

# terminal 1 — the app, pointed at the fake API address the scripts intercept
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=anon npx vite --port 5199 --strictPort

# terminal 2
node tests/ui/pages.mjs         # every page + every role's redirects
node tests/ui/users.mjs         # Users & roles: search to add, caps, empty states
node tests/ui/sheet_fields.mjs  # tracking-sheet fields: show, load into the form, save with the right types
```
Set `BASE_URL` if the app isn't on port 5199, and `SCREENSHOTS=1` to have `pages.mjs` save PNGs.
