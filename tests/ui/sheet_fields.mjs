import { chromium } from 'playwright-core'
const BASE = process.env.BASE_URL || 'http://localhost:5199', SB = 'http://localhost:54321'
const ME = '00000000-0000-0000-0000-0000000000a1', C1 = '00000000-0000-0000-0000-0000000000c1', T1 = '00000000-0000-0000-0000-0000000000f1', CP = '00000000-0000-0000-0000-0000000000b1'
const fw = {
  id: C1, title: 'Freshworks CRM', system_name: 'Freshworks CRM (Customer Relationship Management)', type_id: T1, counterparty_id: CP, owner_id: ME, backup_owner_id: null,
  department: 'GRO', department_manager: 'Roy Eyre', status: 'active', effective_date: '2025-11-10', signed_date: '2025-11-10', expiration_date: '2026-11-10', evergreen: false,
  binding_status: 'binding', sensitivity: 'standard', tags: ['core-operational'], notes: 'https://drive.google.com/open?id=17jQN', renewal_type: 'automatic', renewal_term: '12 months',
  notice_period_days: 60, notice_terms: '60 days', notice_deadline: '2026-09-11', termination_for_convenience: null, termination_notice_days: null,
  value_amount: null, currency: 'USD', payment_terms: null, billing_frequency: null, budget_code: null, annual_amount: 35000, annual_amount_note: 'quoted as $35k',
  mission_justification: 'As a non profit, our donors are critical to our mission.', initial_contract_date: '2020-11-06', initial_signer: 'Sheryl Howe', last_renewal_date: '2025-11-10',
  administrators: 'crm-admin@sil.org', corporate_license: true, google_sso: false, pricing_info: 'See most recent pricing', vendor_contact_note: 'Do not contact the vendor without speaking to the department manager.',
  parent_id: null, amends_id: null, superseded_by_id: null, details: {}, provisions: {}, reminders_enabled: true,
  type: { id: T1, name: 'Software subscription / system', form_kind: 'vendor' }, counterparty: { id: CP, name: 'Freshworks' } }
const writes = []
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] })
async function open(path) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } }); const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await ctx.route(`${SB}/**`, async rt => {
    const req = rt.request(), url = new URL(req.url()), p = url.pathname, name = p.split('/').pop()
    const json = (b, s = 200) => rt.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) })
    if (req.method() === 'OPTIONS') return rt.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    const obj = (req.headers()['accept'] || '').includes('pgrst.object')
    if (name === 'resolve_profile') return json(ME)
    if (name === 'contract_my_role') return json('admin')
    if (name === 'contract_directory') return json([{ id: ME, display_name: 'Test Admin', primary_email: 'admin@sil.org' }])
    if (req.method() !== 'GET' && p.includes('/rest/v1/contracts')) { writes.push({ method: req.method(), body: JSON.parse(req.postData()) }); return json({ id: C1 }, 201) }
    if (name === 'contracts') { const id = url.searchParams.get('id'); const rows = id ? [fw] : [fw]; return obj ? json(rows[0]) : json(rows) }
    if (name === 'contract_types') return json([{ id: T1, name: 'Software subscription / system', form_kind: 'vendor', sort_order: 25, active: true }])
    if (name === 'contract_counterparties') return obj ? json({ id: CP }) : json([{ id: CP, name: 'Freshworks' }])
    if (name === 'profiles') return obj ? json({ id: ME, display_name: 'Test Admin', primary_email: 'admin@sil.org', role: 'member' }) : json([{ id: ME, display_name: 'Test Admin', primary_email: 'admin@sil.org', role: 'member' }])
    return obj ? json(null) : json([])
  })
  await page.addInitScript(() => localStorage.setItem('sb-localhost-auth-token', JSON.stringify({ access_token: 'x.y.z', refresh_token: 'r', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: '10000000-0000-0000-0000-000000000001', email: 'admin@sil.org', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' } })))
  await page.goto(BASE + path); return { page, errors, close: () => ctx.close() }
}
let failed = 0
const check = (n, ok) => { if (!ok) failed++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n) }

// ---- detail page shows every sheet field ----
let t = await open('/contracts/' + C1)
await t.page.getByText('Initial contract').first().waitFor({ timeout: 8000 })
const body = await t.page.locator('main').innerText()
for (const [label, needle] of [
  ['system', 'Freshworks CRM (Customer Relationship Management)'], ['department manager', 'Roy Eyre'], ['initial contract date + signer', 'Nov 6, 2020 · signed by Sheryl Howe'],
  ['last renewal date', 'Nov 10, 2025'], ['next renewal date (label)', 'Expires / next renewal'], ['notice terms as written', '60 days'], ['last day to cancel', 'Sep 11, 2026'],
  ['annual amount + thousands', '$35,000.00 (≈ $35k)'], ['annual amount notes', 'quoted as $35k'], ['mission paragraph', 'our donors are critical to our mission'],
  ['administrators', 'crm-admin@sil.org'], ['pricing info', 'See most recent pricing'], ['corporate license yes', 'Corporate license'], ['vendor contact rule', 'Do not contact the vendor without speaking to the department manager'],
  ['confidentiality notice', 'not to be shared with vendors or outside SIL'], ['drive link in notes', 'drive.google.com/open?id=17jQN']]) check('detail shows ' + label, body.includes(needle))
check('no errors on detail', t.errors.length === 0); if (t.errors.length) console.log(t.errors)
await t.close()

// ---- edit form loads values and saves them with the right types ----
t = await open('/contracts/' + C1 + '/edit')
await t.page.getByText('System and subscription details').waitFor({ timeout: 8000 })
const val = async label => t.page.locator('label', { hasText: label }).locator('input, textarea, select').first().inputValue()
check('form loads department manager', await val('Department manager') === 'Roy Eyre')
check('form loads annual amount', await val('Annual amount (vendor license only)') === '35000')
check('form loads initial signer', await val('Initial contract signer') === 'Sheryl Howe')
check('form loads corporate license = Yes and Google sign-in = No', await val('Corporate (organization-wide) license?') === 'true' && await val('Uses Google sign-in?') === 'false')
check('form loads mission paragraph', (await val('Why this software advances our mission')).includes('donors'))
await t.page.locator('label', { hasText: 'Annual amount: notes' }).locator('input').fill('  quoted as $35k + 2% fees  ')
await t.page.locator('label', { hasText: 'Administrator(s)' }).locator('input').fill('')
await t.page.locator('label', { hasText: 'Uses Google sign-in?' }).locator('select').selectOption('')
await t.page.getByRole('button', { name: 'Save changes' }).click()
await t.page.waitForURL('**/contracts/' + C1, { timeout: 8000 })
const w = writes.at(-1)?.body || {}
check('save sends a PATCH to contracts', writes.at(-1)?.method === 'PATCH')
check('annual_amount sent as a number', w.annual_amount === 35000)
check('free-text notes are trimmed', w.annual_amount_note === 'quoted as $35k + 2% fees')
check('emptied field is sent as null, not ""', w.administrators === null)
check('yes stays true, unknown becomes null (never false)', w.corporate_license === true && w.google_sso === null)
check('dates and names saved', w.initial_contract_date === '2020-11-06' && w.initial_signer === 'Sheryl Howe' && w.last_renewal_date === '2025-11-10' && w.notice_terms === '60 days' && w.system_name.startsWith('Freshworks'))
check('vendor contact rule saved', w.vendor_contact_note.startsWith('Do not contact'))
check('no errors on edit/save', t.errors.length === 0); if (t.errors.length) console.log(t.errors)
await t.close()

// ---- new contract form: fields present for a software type, blanks saved as null ----
t = await open('/contracts/new')
await t.page.getByText('System and subscription details').waitFor({ timeout: 8000 })
await t.page.locator('label', { hasText: 'Title' }).first().locator('input').fill('Zoom')
await t.page.locator('label', { hasText: 'Counterparty' }).locator('input').fill('Zoom')
await t.page.locator('label', { hasText: 'Department / program' }).locator('input').fill('GTIS')
await t.page.locator('label', { hasText: 'Internal owner' }).locator('select').selectOption(ME)
await t.page.getByRole('button', { name: 'Create contract' }).click()
await t.page.waitForURL('**/contracts/' + C1, { timeout: 8000 })
const n = writes.at(-1)?.body || {}
check('new contract: POST', writes.at(-1)?.method === 'POST')
check('new contract: untouched sheet fields are null', n.annual_amount === null && n.corporate_license === null && n.google_sso === null && n.initial_contract_date === null && n.system_name === null && n.administrators === null)
check('new contract: no errors', t.errors.length === 0); if (t.errors.length) console.log(t.errors)
await t.close(); await browser.close(); process.exit(failed ? 1 : 0)
