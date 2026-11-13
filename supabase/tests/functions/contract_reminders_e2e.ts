// Run: deno run -A --no-check supabase/tests/functions/contract_reminders_e2e.ts
// Exercises the real contract-reminders handler with the database and send-email mocked at the fetch layer.
let handler: (r: Request) => Promise<Response> = () => { throw new Error('no handler') }
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = (h: typeof handler) => { handler = h; return {} }
Deno.env.set('SUPABASE_URL', 'http://mock.supabase')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
Deno.env.set('CRON_SECRET', 'cron-secret')
Deno.env.set('CONTRACTS_APP_ORIGIN', 'https://contracts.test')

const due = [
  { contract_id: 'c1', milestone_id: null, kind: 'notice_60', notice_deadline: '2026-07-03', due_on: '2026-07-03', days_left: 60, title: 'Acme <MSA> & Co', counterparty: 'Acme', owner_name: 'Olive', to_emails: ['o@sil.org', 'b@sil.org'] },
  { contract_id: 'c2', milestone_id: null, kind: 'escalation', notice_deadline: '2026-07-03', due_on: '2026-07-03', days_left: 7, title: 'Beta', counterparty: 'Beta', owner_name: 'Olive', to_emails: ['b@sil.org'] },
  { contract_id: 'c3', milestone_id: 'm1', kind: 'milestone', notice_deadline: null, due_on: '2026-06-11', days_left: 10, title: 'Gamma', counterparty: 'Gamma', owner_name: 'Olive', to_emails: ['o@sil.org'] },
  { contract_id: 'c4', milestone_id: null, kind: 'passed_deadline', notice_deadline: '2026-06-01', due_on: '2026-06-01', days_left: -3, title: 'Delta', counterparty: 'Delta', owner_name: 'Olive', to_emails: ['o@sil.org'] },
]
const sent: Record<string, any>[] = []; const logs: Record<string, any>[] = []; const authSeen: (string | null)[] = []
let flaky = true   // first send-email call for 'Beta' fails, retry succeeds; Gamma always fails
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(input, init); const url = new URL(req.url)
  if (url.pathname === '/rest/v1/rpc/contract_resync_signatories') return Response.json(null)
  if (url.pathname === '/rest/v1/rpc/contract_reminders_due') return Response.json(due)
  if (url.pathname === '/rest/v1/contract_reminder_log') { logs.push(await req.json()); return new Response(null, { status: 201 }) }
  if (url.pathname === '/functions/v1/send-email') {
    authSeen.push(req.headers.get('authorization')); const body = await req.json(); sent.push(body)
    if (body.subject.includes('Gamma')) return new Response('resend down', { status: 500 })
    if (body.subject.includes('Beta') && flaky) { flaky = false; return new Response('blip', { status: 502 }) }
    return Response.json({ success: true })
  }
  throw new Error('unexpected fetch ' + req.url)
}
await import('../../functions/contract-reminders/index.ts')
const call = (auth: string | null, body: unknown = {}) => handler(new Request('http://x', { method: 'POST', headers: auth ? { Authorization: auth, 'Content-Type': 'application/json' } : {}, body: JSON.stringify(body) }))
let failed = 0
const check = (n: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`) }

check('no auth -> 401', (await call(null)).status, 401)
check('wrong secret -> 401', (await call('Bearer nope')).status, 401)
check('nothing sent before auth', sent.length, 0)
const dry = await (await call('Bearer cron-secret', { dry_run: true })).json()
check('dry run lists due reminders and sends nothing', [dry.dry_run, dry.due.length, sent.length, logs.length], [true, 4, 0, 0])

const res = await (await call('Bearer cron-secret')).json()
check('summary: 3 sent, 1 failed', [res.considered, res.sent, res.failed], [4, 3, 1])
check('every email carries app: contracts and the cron secret', [sent.every(s => s.app === 'contracts'), authSeen.every(a => a === 'Bearer cron-secret')], [true, true])
check('transient failure retried once and then logged as sent', logs.filter(l => l.kind === 'escalation').map(l => l.status), ['sent'])
check('persistent failure retried once, logged as failed with the error', [sent.filter(s => s.subject.includes('Gamma')).length, logs.find(l => l.kind === 'milestone')!.status, String(logs.find(l => l.kind === 'milestone')!.error).includes('resend down')], [2, 'failed', true])
check('log rows carry recipients, deadline and milestone id', [logs[0].recipients, logs[0].notice_deadline, logs.find(l => l.kind === 'milestone')!.milestone_id], [['o@sil.org', 'b@sil.org'], '2026-07-03', 'm1'])
const notice = sent.find(s => s.template === 'contract_reminder_notice_60')!
check('subject names the contract and days', notice.subject, 'Contract notice deadline in 60 days: Acme <MSA> & Co')
check('HTML-escapes titles', notice.html.includes('Acme &lt;MSA&gt; &amp; Co') && !notice.html.includes('<MSA>'), true)
check('email states the next action and links to the record with decide=1', [notice.html.includes('Next action'), notice.html.includes('https://contracts.test/contracts/c1?decide=1')], [true, true])
check('escalation email names the owner and says ESCALATION', [sent.find(s => s.template === 'contract_reminder_escalation')!.subject.startsWith('ESCALATION'), sent.find(s => s.template === 'contract_reminder_escalation')!.html.includes('Olive')], [true, true])
check('passed-deadline email asks "renewed automatically?"', sent.find(s => s.template === 'contract_reminder_passed_deadline')!.html.includes('renewed already'), true)
Deno.exit(failed ? 1 : 0)
