import { chromium } from 'playwright-core'
const BASE = process.env.BASE_URL || 'http://localhost:5199', SB = 'http://localhost:54321'
const ME = '00000000-0000-0000-0000-0000000000a1'
const people = [
  { profile_id: ME, display_name: 'Test Admin', primary_email: 'admin@sil.org', role: 'admin' },
  { profile_id: 'p2', display_name: 'Cora Contrib', primary_email: 'cora@sil.org', role: 'contributor' },
]
const everyoneElse = [
  { profile_id: 'p9', display_name: 'Scott Kohler', primary_email: 'scott_kohler@sil.org' },
  { profile_id: 'p8', display_name: 'Scott Xkohler', primary_email: 'scottXkohler@sil.org' },
  ...Array.from({ length: 100 }, (_, i) => ({ profile_id: 'b' + i, display_name: 'Bulk Person ' + i, primary_email: `bulk${i}@sil.org` })),
]
const calls = { search: [], roleWrites: [], adminUsers: 0 }
const esc = q => q // mock mirrors server: literal match, '_' is literal
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } })
const page = await ctx.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
await ctx.route(`${SB}/**`, async rt => {
  const req = rt.request(), url = new URL(req.url()), p = url.pathname
  const json = (b, s = 200) => rt.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) })
  if (req.method() === 'OPTIONS') return rt.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  const name = p.split('/').pop()
  if (name === 'resolve_profile') return json(ME)
  if (name === 'contract_my_role') return json('admin')
  if (name === 'contract_admin_users') { calls.adminUsers++; return json(people) }
  if (name === 'contract_search_profiles') {
    const { p_query } = JSON.parse(req.postData()); calls.search.push(p_query)
    const q = p_query.trim().toLowerCase()
    return json(q.length < 2 ? [] : everyoneElse.filter(x => (x.display_name + '|' + x.primary_email).toLowerCase().includes(q)).slice(0, 25))
  }
  if (name === 'contract_roles' && req.method() !== 'GET') {
    const body = JSON.parse(req.postData()); calls.roleWrites.push(body)
    const who = everyoneElse.find(x => x.profile_id === body.profile_id)
    if (who) { people.push({ ...who, role: body.role }); everyoneElse.splice(everyoneElse.indexOf(who), 1) }
    return json({}, 201)
  }
  if (p.startsWith('/rest/v1/')) return (req.headers()['accept'] || '').includes('pgrst.object') ? json({ id: ME, display_name: 'Test Admin', primary_email: 'admin@sil.org', role: 'member' }) : json(name === 'profiles' ? [{ id: ME, display_name: 'Test Admin', primary_email: 'admin@sil.org', role: 'member' }] : [])
  return json({})
})
await page.addInitScript(() => localStorage.setItem('sb-localhost-auth-token', JSON.stringify({ access_token: 'x.y.z', refresh_token: 'r', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: '10000000-0000-0000-0000-000000000001', email: 'admin@sil.org', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' } })))
let failed = 0
const check = (n, ok) => { if (!ok) failed++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n) }

await page.goto(BASE + '/admin/users')
await page.getByText('People with access (2)').waitFor({ timeout: 8000 })
check('default view lists only the 2 people who have roles', await page.locator('table tbody tr').count() === 2)
check('Scott is not shown by default (nor the 100 others)', !(await page.getByText('Scott Kohler').count()) && !(await page.getByText('Bulk Person').count()))
check('prompts for at least two letters', await page.getByText('Type at least two letters').isVisible())

const box = page.getByLabel('Search for a person')
await box.fill('s'); await page.waitForTimeout(600)
check('one letter does not trigger a search', calls.search.length === 0)
await box.fill('scott_kohler')
await page.getByText('Scott Kohler').first().waitFor({ timeout: 5000 })
check('searching "scott_kohler" finds Scott', await page.getByText('scott_kohler@sil.org').isVisible())
check('search was sent once, debounced (not once per keystroke)', calls.search.filter(q => q.length > 1).length === 1)
check('the look-alike address is not returned', !(await page.getByText('scottXkohler@sil.org').count()))
await page.screenshot({ path: 'users_search.png' }).catch(() => {})

await page.getByLabel('Role to give').selectOption('contributor')
await page.getByRole('button', { name: /Add as Contributor/ }).click()
await page.getByText('Scott Kohler added as Contributor.').waitFor({ timeout: 5000 })
check('role write sent for Scott with the chosen role', calls.roleWrites.length === 1 && calls.roleWrites[0].profile_id === 'p9' && calls.roleWrites[0].role === 'contributor' && calls.roleWrites[0].granted_by === ME)
await page.getByText('People with access (3)').waitFor({ timeout: 5000 })
check('list refreshes and now includes Scott', await page.locator('table tbody tr', { hasText: 'Scott Kohler' }).count() === 1)

await box.fill('zzzz-nobody'); await page.getByText('No one without access matches').waitFor({ timeout: 5000 })
check('helpful message when nobody matches', await page.getByText('have signed in to a SIL app').isVisible())
await box.fill('bulk'); await page.getByText('Showing the first 25').waitFor({ timeout: 5000 })
check('large result sets are capped with a hint to narrow down', (await page.locator('li button', { hasText: 'Add as' }).count()) === 25)
check('no console or page errors', errors.length === 0)
if (errors.length) console.log(errors)
await browser.close(); process.exit(failed ? 1 : 0)
