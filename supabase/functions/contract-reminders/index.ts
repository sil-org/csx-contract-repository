import { createClient } from 'jsr:@supabase/supabase-js@2'
import { json, safeEqual } from '../_shared/http.ts'

// Daily job (pg_cron — supabase/contracts/02_schedule_reminders.sql) that sends
// contract notice-deadline / escalation / milestone reminders.
//
// All the "what is due" logic lives in the Postgres function
// contract_reminders_due() (unit-tested in supabase/tests/); this function only
// delivers and records the outcome:
//   * sent   -> a 'sent' contract_reminder_log row, which stops a repeat this cycle
//   * failed -> a 'failed' row (surfaced to admins); it does NOT stop a repeat, so
//               the next daily run retries. One immediate retry here as well (R-R10).
//
// Auth: CRON_SECRET bearer token (same secret/Vault entry license-manager's
// scheduled functions use). Deployed with --no-verify-jwt.
//
// Email goes through the shared `send-email` function with app: 'contracts'
// (sender/reply-to chosen server-side there). The same CRON_SECRET authenticates us to it.

const CRON_SECRET = Deno.env.get('CRON_SECRET')
const APP_ORIGIN = Deno.env.get('CONTRACTS_APP_ORIGIN') ?? 'https://contracts.sil.org'

interface Due {
  contract_id: string; milestone_id: string | null; kind: string; notice_deadline: string | null
  due_on: string; days_left: number; title: string; counterparty: string; owner_name: string
  to_emails: string[]; missing_fields: string[] | null
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const fmt = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`

function compose(r: Due): { subject: string; html: string } {
  const link = `${APP_ORIGIN}/contracts/${r.contract_id}`
  const decide = `${link}?decide=1`
  const what = `<strong>${esc(r.title)}</strong> with ${esc(r.counterparty)}`
  const btn = (href: string, label: string) =>
    `<p><a href="${href}" style="display:inline-block;background:#005CB9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${label}</a></p>`
  const actions = `<p><strong>Next action:</strong> decide whether to <em>renew</em>, <em>renegotiate</em>, <em>terminate</em>, or confirm <em>no action</em> is needed, and record it so these reminders stop.</p>`
  let subject: string, body: string

  if (r.kind === 'milestone') {
    subject = `Milestone due in ${plural(r.days_left)}: ${r.title}`
    body = `<p>A milestone on ${what} is due <strong>${fmt(r.due_on)}</strong> (${plural(r.days_left)}).</p>` + btn(link, 'Open contract')
  } else if (r.kind.startsWith('termination_notice_')) {
    subject = `Termination notice deadline in ${plural(r.days_left)}: ${r.title}`
    body = `<p>The notice deadline for ${what} is <strong>${fmt(r.due_on)}</strong> — ${plural(r.days_left)} away. If no action is taken by then, this contract may renew or terminate automatically.</p>` + btn(link, 'Open contract')
  } else if (r.kind.startsWith('contract_end_notice_')) {
    subject = `Contract end date in ${plural(r.days_left)}: ${r.title}`
    body = `<p>${what} is set to end on <strong>${fmt(r.due_on)}</strong> — ${plural(r.days_left)} away.</p>` + btn(link, 'Open contract')
  } else if (r.kind === 'missing_data_update' || r.kind === 'missing_data_escalation') {
    const escalated = r.kind === 'missing_data_escalation'
    subject = `${escalated ? 'ESCALATION — ' : ''}Missing information: ${r.title}`
    const list = (r.missing_fields ?? []).map(f => `<li>${esc(f)}</li>`).join('')
    body = `<p>${what}${escalated ? ' is still' : ' is'} missing the following information${escalated ? ', first flagged over a month ago' : ''}:</p>
            <ul>${list}</ul>
            <p><strong>Next action:</strong> add the missing information to the contract record.</p>` + btn(link, 'Open contract')
  } else if (r.kind === 'termination_date_update' || r.kind === 'termination_date_escalation') {
    const escalated = r.kind === 'termination_date_escalation'
    subject = `${escalated ? 'ESCALATION — ' : ''}Confirm what happened: ${r.title}`
    body = `<p>${what} had a contract end date of <strong>${fmt(r.due_on)}</strong>, which has passed, and no termination date has been recorded.</p>
            <p><strong>Next action:</strong> confirm whether this contract was renewed, terminated or allowed to lapse, and record the termination date (if any) on the contract record.</p>` + btn(link, 'Open contract')
  } else if (r.kind === 'escalation') {
    subject = `ESCALATION — no decision yet: ${r.title} (notice due ${fmt(r.due_on)})`
    body = `<p>The notice deadline for ${what} is <strong>${fmt(r.due_on)}</strong> — ${plural(r.days_left)} away — and no decision has been recorded by the contract owner, ${esc(r.owner_name)}.</p>${actions}` + btn(decide, 'Record a decision')
  } else if (r.kind === 'passed_deadline') {
    subject = `Notice deadline passed: ${r.title}`
    body = `<p>The notice deadline for ${what} was <strong>${fmt(r.due_on)}</strong> and no decision was recorded. If this contract renews automatically, it may have renewed already.</p>
            <p><strong>Next action:</strong> confirm what happened, then update the contract's dates (or status) and record the decision.</p>` + btn(decide, 'Review and record a decision')
  } else {
    const label = r.kind.replace('notice_', '')
    subject = `Contract notice deadline in ${plural(r.days_left)}: ${r.title}`
    body = `<p>The notice deadline for ${what} is <strong>${fmt(r.due_on)}</strong> — ${plural(r.days_left)} away (${label}-day reminder).</p>${actions}` + btn(decide, 'Record a decision')
  }
  const html = `<div style="font-family:Source Sans 3,Arial,sans-serif;max-width:560px;color:#222">${body}
    <p style="color:#666;font-size:12px">Contract owner: ${esc(r.owner_name)} · <a href="${link}">View contract</a></p></div>`
  return { subject, html }
}

async function sendOnce(r: Due): Promise<{ ok: boolean; error?: string }> {
  const { subject, html } = compose(r)
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CRON_SECRET}` },
    body: JSON.stringify({ app: 'contracts', to: r.to_emails, subject, html, template: `contract_reminder_${r.kind}` }),
  })
  if (res.ok) return { ok: true }
  return { ok: false, error: `send-email ${res.status}: ${(await res.text()).slice(0, 500)}` }
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || !safeEqual(req.headers.get('Authorization') ?? '', `Bearer ${CRON_SECRET}`)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // Optional { limit: n, dry_run: true } for safe smoke tests against real data.
  const { limit, dry_run } = await req.json().catch(() => ({} as { limit?: number; dry_run?: boolean }))

  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Catches a signatory-history entry whose start_date has just arrived (09_responsible_party_
    // history.sql) -- best-effort housekeeping, so a failure here shouldn't block real reminders.
    const { error: resyncErr } = await db.rpc('contract_resync_signatories')
    if (resyncErr) console.error('could not resync signatories', resyncErr.message)

    const { data, error } = await db.rpc('contract_reminders_due')
    if (error) throw error
    let due = (data ?? []) as Due[]
    if (dry_run) return json({ ok: true, dry_run: true, due: due.map(d => ({ contract: d.title, kind: d.kind, to: d.to_emails })) })
    if (typeof limit === 'number') due = due.slice(0, limit)

    let sent = 0, failed = 0
    for (const r of due) {
      let result = await sendOnce(r)
      if (!result.ok) result = await sendOnce(r)   // one immediate retry
      const { error: logErr } = await db.from('contract_reminder_log').insert({
        contract_id: r.contract_id, milestone_id: r.milestone_id, kind: r.kind,
        notice_deadline: r.notice_deadline, recipients: r.to_emails,
        status: result.ok ? 'sent' : 'failed', error: result.error ?? null,
      })
      if (logErr) console.error('could not log reminder', r.contract_id, r.kind, logErr.message)
      result.ok ? sent++ : failed++
    }
    return json({ ok: true, considered: due.length, sent, failed })
  } catch (e) {
    console.error('contract-reminders error:', e)
    return json({ error: 'Internal error' }, 500)
  }
})
