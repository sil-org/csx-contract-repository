import { useEffect, useState } from 'react'
import { getSettings, saveSetting, listTypes, saveType } from '../../lib/contracts'
import { Page, Card, Field, ErrorMsg, Loading, btnPrimary, btnSecondary, inputCls } from '../../components/ui'
import AdminTabs from '../../components/AdminTabs'

const KINDS = { mou: 'MOU fields', sow: 'SOW fields', vendor: 'Vendor fields', other: 'General' }

export default function AdminSettings() {
  const [s, setS] = useState(null)
  const [types, setTypes] = useState([])
  const [form, setForm] = useState({ leads: '', esc: '', mlead: '', fallback: '' })
  const [notif, setNotif] = useState({
    termLeads: '', endLeads: '', mduDays: '', mdeDays: '', tduDays: '', tdeDays: '', mdeEmails: '', tdeEmails: '',
  })
  const [newType, setNewType] = useState({ name: '', form_kind: 'other' })
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  const load = async () => {
    try {
      const [settings, t] = await Promise.all([getSettings(), listTypes({ includeInactive: true })])
      setS(settings); setTypes(t)
      setForm({ leads: (settings.reminder_lead_days || []).join(', '), esc: settings.escalation_days ?? 7, mlead: settings.milestone_lead_days ?? 14, fallback: settings.escalation_fallback_email || '' })
      setNotif({
        termLeads: (settings.termination_notice_lead_days || []).join(', '),
        endLeads: (settings.contract_end_lead_days || []).join(', '),
        mduDays: settings.missing_data_update_days ?? 14, mdeDays: settings.missing_data_escalation_days ?? 30,
        tduDays: settings.termination_date_update_days ?? 14, tdeDays: settings.termination_date_escalation_days ?? 30,
        mdeEmails: (settings.missing_data_escalation_emails || []).join(', '),
        tdeEmails: (settings.termination_escalation_emails || []).join(', '),
      })
    } catch (e) { setErr(e) }
  }
  useEffect(() => { load() }, [])

  async function saveReminders(e) {
    e.preventDefault(); setErr(null); setMsg(null)
    try {
      const leads = form.leads.split(',').map(x => parseInt(x.trim(), 10)).filter(n => Number.isInteger(n) && n > 0)
      if (!leads.length) throw new Error('Enter at least one lead time in days, e.g. 120, 60, 14.')
      const esc = parseInt(form.esc, 10), mlead = parseInt(form.mlead, 10)
      if (!(esc >= 0) || !(mlead >= 0)) throw new Error('Escalation and milestone lead times must be numbers of days.')
      const fb = form.fallback.trim()
      if (fb && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fb)) throw new Error('Fallback contact must be an email address.')
      await saveSetting('reminder_lead_days', [...new Set(leads)].sort((a, b) => b - a))
      await saveSetting('escalation_days', esc)
      await saveSetting('milestone_lead_days', mlead)
      await saveSetting('escalation_fallback_email', fb || null)
      setMsg('Saved. Changes apply from the next daily run.'); load()
    } catch (e2) { setErr(e2) }
  }
  async function saveNotif(e) {
    e.preventDefault(); setErr(null); setMsg(null)
    try {
      const days = (v, label) => { const n = parseInt(v, 10); if (!(n >= 0)) throw new Error(`${label} must be a number of days.`); return n }
      const leadList = (v, label) => {
        const n = v.split(',').map(x => parseInt(x.trim(), 10)).filter(x => Number.isInteger(x) && x > 0)
        if (!n.length) throw new Error(`Enter at least one lead time in days for ${label}.`)
        return [...new Set(n)].sort((a, b) => b - a)
      }
      const emailList = (v, label) => {
        const list = v.split(',').map(x => x.trim()).filter(Boolean)
        if (list.some(x => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) throw new Error(`${label} must be a comma-separated list of email addresses.`)
        return list
      }
      await saveSetting('termination_notice_lead_days', leadList(notif.termLeads, 'termination notice'))
      await saveSetting('contract_end_lead_days', leadList(notif.endLeads, 'contract end notice'))
      await saveSetting('missing_data_update_days', days(notif.mduDays, 'Missing-data update interval'))
      await saveSetting('missing_data_escalation_days', days(notif.mdeDays, 'Missing-data escalation interval'))
      await saveSetting('termination_date_update_days', days(notif.tduDays, 'Termination-date update interval'))
      await saveSetting('termination_date_escalation_days', days(notif.tdeDays, 'Termination-date escalation interval'))
      await saveSetting('missing_data_escalation_emails', emailList(notif.mdeEmails, 'Missing-data escalation recipients'))
      await saveSetting('termination_escalation_emails', emailList(notif.tdeEmails, 'Termination escalation recipients'))
      setMsg('Saved. Changes apply from the next daily run.'); load()
    } catch (e2) { setErr(e2) }
  }
  async function toggle(t) { try { await saveType({ ...t, active: !t.active }); load() } catch (e) { setErr(e) } }
  async function add(e) {
    e.preventDefault(); setErr(null)
    try { await saveType({ name: newType.name.trim(), form_kind: newType.form_kind, sort_order: 50 }); setNewType({ name: '', form_kind: 'other' }); load() } catch (e2) { setErr(e2) }
  }

  return (
    <Page title="Settings" tabs={<AdminTabs />}>
      <ErrorMsg error={err} />
      {msg && <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-3 py-2 mb-3">{msg}</div>}
      {!s ? <Loading /> : (
        <>
          <Card title="Reminders">
            <form onSubmit={saveReminders} className="grid md:grid-cols-2 gap-4">
              <Field label="Reminder lead times (days before the notice deadline)" hint="Comma-separated, e.g. 120, 60, 14 — planning, decision, final.">
                <input className={inputCls} value={form.leads} onChange={e => setForm(f => ({ ...f, leads: e.target.value }))} /></Field>
              <Field label="Escalate if no decision this many days before" hint="Goes to the backup owner and the fallback contact.">
                <input type="number" min="0" className={inputCls} value={form.esc} onChange={e => setForm(f => ({ ...f, esc: e.target.value }))} /></Field>
              <Field label="Escalation fallback contact (email)" hint="Used for escalations, alongside each contract's backup owner. Leave blank if none.">
                <input type="email" className={inputCls} value={form.fallback} onChange={e => setForm(f => ({ ...f, fallback: e.target.value }))} /></Field>
              <Field label="Milestone reminder lead (days)"><input type="number" min="0" className={inputCls} value={form.mlead} onChange={e => setForm(f => ({ ...f, mlead: e.target.value }))} /></Field>
              <div className="md:col-span-2"><button className={btnPrimary}>Save reminder settings</button></div>
            </form>
          </Card>
          <Card title="Notification requirements">
            <form onSubmit={saveNotif} className="grid md:grid-cols-2 gap-4">
              <Field label="Termination notice lead times (days before the computed notice deadline)" hint="To the signatory and department manager, separately from the reminder above. Comma-separated, e.g. 90, 30.">
                <input className={inputCls} value={notif.termLeads} onChange={e => setNotif(f => ({ ...f, termLeads: e.target.value }))} /></Field>
              <Field label="Contract-end lead times (days before the contract end date)" hint="Comma-separated, e.g. 90, 30.">
                <input className={inputCls} value={notif.endLeads} onChange={e => setNotif(f => ({ ...f, endLeads: e.target.value }))} /></Field>
              <Field label="Missing-data reminder: first nudge + repeat (days after the record was added)" hint="To the signatory and department manager, while any required field is still blank.">
                <input type="number" min="0" className={inputCls} value={notif.mduDays} onChange={e => setNotif(f => ({ ...f, mduDays: e.target.value }))} /></Field>
              <Field label="Missing-data escalation: first nudge + repeat (days after the record was added)">
                <input type="number" min="0" className={inputCls} value={notif.mdeDays} onChange={e => setNotif(f => ({ ...f, mdeDays: e.target.value }))} /></Field>
              <Field label="Missing-data escalation recipients" hint="Comma-separated emails. Left blank, this escalation never sends.">
                <input className={inputCls} value={notif.mdeEmails} onChange={e => setNotif(f => ({ ...f, mdeEmails: e.target.value }))} /></Field>
              <div className="hidden md:block" />
              <Field label="Termination-date reminder: repeat interval (days)" hint="Starts immediately once the contract end date has passed and no termination date is recorded.">
                <input type="number" min="0" className={inputCls} value={notif.tduDays} onChange={e => setNotif(f => ({ ...f, tduDays: e.target.value }))} /></Field>
              <Field label="Termination-date escalation: threshold + repeat (days past the end date)">
                <input type="number" min="0" className={inputCls} value={notif.tdeDays} onChange={e => setNotif(f => ({ ...f, tdeDays: e.target.value }))} /></Field>
              <Field label="Termination-date escalation recipients" hint="Comma-separated emails (e.g. CFO, CTO). Left blank, this escalation never sends." className="md:col-span-2">
                <input className={inputCls} value={notif.tdeEmails} onChange={e => setNotif(f => ({ ...f, tdeEmails: e.target.value }))} /></Field>
              <div className="md:col-span-2"><button className={btnPrimary}>Save notification settings</button></div>
            </form>
          </Card>
          <Card title="Contract types">
            <ul className="divide-y divide-gray-100 mb-3 text-sm">
              {types.map(t => (
                <li key={t.id} className="py-2 flex items-center gap-3">
                  <span className={t.active ? '' : 'text-gray-400 line-through'}>{t.name}</span>
                  <span className="text-xs text-gray-400">{KINDS[t.form_kind]}</span>
                  <button className="ml-auto text-brand text-xs hover:underline" onClick={() => toggle(t)}>{t.active ? 'Retire' : 'Restore'}</button>
                </li>
              ))}
            </ul>
            <form onSubmit={add} className="flex flex-wrap gap-2 items-end">
              <Field label="New type" className="flex-1 min-w-[12rem]"><input required className={inputCls} placeholder="e.g. Non-disclosure agreement" value={newType.name} onChange={e => setNewType(n => ({ ...n, name: e.target.value }))} /></Field>
              <Field label="Form fields"><select className={inputCls} value={newType.form_kind} onChange={e => setNewType(n => ({ ...n, form_kind: e.target.value }))}>
                {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <button className={btnSecondary}>Add type</button>
            </form>
            <p className="text-xs text-gray-400 mt-2">Retiring a type hides it from new contracts; existing contracts keep it.</p>
          </Card>
        </>
      )}
    </Page>
  )
}
