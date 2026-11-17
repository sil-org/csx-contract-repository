import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL || 'http://localhost:5199'
const SB = 'http://localhost:54321'
const P = '00000000-0000-0000-0000-0000000000a1'
const C1 = '00000000-0000-0000-0000-0000000000c1'
const T1 = '00000000-0000-0000-0000-0000000000f1'
const CP = '00000000-0000-0000-0000-0000000000b1'
const inDays = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

const contract = (id, title, over = {}) => ({
  id, title, type_id: T1, counterparty_id: CP, owner_id: P, backup_owner_id: null, department: 'Ops', status: 'active',
  effective_date: '2025-01-01', signed_date: '2024-12-15', expiration_date: inDays(90), evergreen: false,
  sensitivity: 'standard', tags: ['it'], notes: 'hello', renewal_type: 'automatic', renewal_term: '12 months', notice_period_days: 60,
  notice_deadline: inDays(30), termination_for_convenience: true, termination_notice_days: 30, value_amount: 12000, currency: 'USD',
  payment_terms: 'Net 30', billing_frequency: 'Annual', budget_code: 'X1', amends_id: null, superseded_by_id: null,
  sign_on_methods: [], annual_amount: 1000, mission_justification: 'Fake mission text.', initial_contract_date: '2025-01-01',
  signatory_name: 'Jo Signer', signatory_email: 'jo@acme.example', contract_length_years: 1,
  details: { vendor_contact: 'Pat' }, provisions: { confidentiality: true }, reminders_enabled: true,
  type: { id: T1, name: 'Vendor contract', form_kind: 'vendor' }, counterparty: { id: CP, name: 'Acme Ltd' }, ...over,
})
const contracts = [contract(C1, 'Acme hosting MSA'), contract('00000000-0000-0000-0000-0000000000c2', 'Old draft', { status: 'draft', notice_deadline: null, expiration_date: null })]
const me = { id: P, display_name: 'Test Admin', primary_email: 'admin@sil.org', role: 'member' }
const doc = { id: 'd1', contract_id: C1, doc_key: 'k1', version: 2, role: 'original', filename: 'msa.pdf', content_type: 'application/pdf', size_bytes: 123456,
  sha256: 'a'.repeat(64), change_note: 'Fixed signature page', uploaded_by: P, uploaded_at: new Date().toISOString() }

let role = 'admin'
const tables = {
  profiles: [me],
  contracts, contract_types: [{ id: T1, name: 'Vendor contract', form_kind: 'vendor', sort_order: 30, active: true }],
  contract_counterparties: [{ id: CP, name: 'Acme Ltd' }],
  contract_decisions: [], contract_documents: [doc, { ...doc, id: 'd0', version: 1, change_note: 'Executed copy' }], contract_milestones: [{ id: 'm1', contract_id: C1, due_on: inDays(10), description: 'Phase 1', completed_at: null }],
  contract_links: [{ id: 'l1', contract_id: C1, url: 'https://drive.google.com/x', label: 'Working copy' }], contract_access: [],
  contract_settings: [{ key: 'reminder_lead_days', value: [120, 60, 14] }, { key: 'escalation_days', value: 7 }, { key: 'milestone_lead_days', value: 14 }, { key: 'escalation_fallback_email', value: null }],
  contract_reminder_log: [{ id: 'r1', contract_id: C1, kind: 'notice_60', notice_deadline: inDays(30), recipients: ['a@sil.org'], status: 'failed', error: 'boom', created_at: new Date().toISOString(), contract: { title: 'Acme hosting MSA' } }],
  contract_audit_log: [{ id: 1, at: new Date().toISOString(), profile_id: P, action: 'update', entity: 'contracts', contract_id: C1, old_values: { notes: 'a' }, new_values: { notes: 'b' }, ip_address: '1.2.3.4' }],
  linked_accounts: [],
}
const rpcs = {
  resolve_profile: () => P, contract_my_role: () => (role === 'null' ? null : role),
  contract_directory: () => [{ id: P, display_name: 'Test Admin', primary_email: 'admin@sil.org' }],
  contract_admin_users: () => [{ profile_id: P, display_name: 'Test Admin', primary_email: 'admin@sil.org', role: 'admin' }, { profile_id: 'x', display_name: 'Lou License', primary_email: 'lou@sil.org', role: null }],
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] })
const results = []
async function visit(name, path, expectText, r = 'admin', shot) {
  role = r
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error' && !/favicon|fonts\.g/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)) })
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, rt => rt.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await ctx.route(`${SB}/**`, async rt => {
    const url = new URL(rt.request().url()); const p = url.pathname
    const json = (b, s = 200) => rt.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) })
    if (rt.request().method() === 'OPTIONS') return rt.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    if (p.startsWith('/rest/v1/rpc/')) return json(rpcs[p.split('/').pop()]?.() ?? null)
    if (p.startsWith('/rest/v1/')) {
      const t = p.split('/').pop(); let rows = tables[t] ?? []
      const id = url.searchParams.get('id'); if (id?.startsWith('eq.')) rows = rows.filter(x => x.id === id.slice(3))
      const cid = url.searchParams.get('contract_id'); if (cid?.startsWith('eq.')) rows = rows.filter(x => x.contract_id === cid.slice(3))
      if (rt.request().method() !== 'GET') return json(rows[0] ?? {}, 201)
      return (rt.request().headers()['accept'] || '').includes('pgrst.object') ? json(rows[0] ?? null) : json(rows)
    }
    return json({})
  })
  await page.addInitScript(() => localStorage.setItem('sb-localhost-auth-token', JSON.stringify({
    access_token: 'x.y.z', refresh_token: 'r', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999,
    user: { id: '10000000-0000-0000-0000-000000000001', email: 'admin@sil.org', aud: 'authenticated', app_metadata: {}, user_metadata: { full_name: 'Test Admin' }, created_at: '' } })))
  await page.goto(BASE + path)
  let ok = true
  try { await page.getByText(expectText, { exact: false }).first().waitFor({ timeout: 6000 }) } catch { ok = false }
  await page.waitForTimeout(300)
  if (shot && process.env.SCREENSHOTS) await page.screenshot({ path: shot, fullPage: true })
  results.push({ name, ok: ok && !errors.length, errors, url: page.url().replace(BASE, '') })
  await ctx.close()
}

await visit('dashboard', '/dashboard', 'Acme hosting MSA', 'admin', 'dash.png')
await visit('contracts list', '/contracts', 'Old draft')
await visit('contract detail', '/contracts/' + C1, 'Fixed signature page', 'admin', 'detail.png')
await visit('detail ?decide=1 (from reminder email)', '/contracts/' + C1 + '?decide=1', 'Renewal decision')
await visit('new contract form', '/contracts/new', 'Create contract')
await visit('edit contract form', '/contracts/' + C1 + '/edit', 'Save changes')
await visit('admin index -> redirects to settings', '/admin', 'Reminder lead times')
await visit('admin users', '/admin/users', 'People with access', 'admin', 'users.png')
await visit('admin settings', '/admin/settings', 'Reminder lead times')
await visit('reminder log', '/admin/reminders', 'boom'.length ? 'Failed' : '')
await visit('audit log', '/admin/audit', '1.2.3.4')
await visit('viewer: sees list', '/contracts', 'Acme hosting MSA', 'viewer')
await visit('viewer: no "New contract" route -> redirected', '/contracts/new', 'Acme hosting MSA', 'viewer')
await visit('viewer: admin page -> redirected', '/admin/users', 'Coming due', 'viewer')
await visit('auditor: audit log ok', '/admin/audit', '1.2.3.4', 'auditor')
await visit('auditor: users page -> redirected', '/admin/users', 'Coming due', 'auditor')
await visit('auditor: admin index -> redirects to audit (not settings)', '/admin', '1.2.3.4', 'auditor')
await visit('no role -> access needed', '/dashboard', 'Access needed', 'null', 'noaccess.png')
await browser.close()
let bad = 0
for (const r of results) { console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + '  → ' + r.url); r.errors.forEach(e => console.log('        ' + e)); if (!r.ok) bad++ }
process.exit(bad ? 1 : 0)
