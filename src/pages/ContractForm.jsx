import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { getContract, listTypes, listCounterparties, getDirectory, listContracts, findOrCreateCounterparty, saveContract } from '../lib/contracts'
import { STATUS_LABELS, BINDING_LABELS, RENEWAL_LABELS, PROVISIONS } from '../lib/format'
import { Page, Card, Field, ErrorMsg, Loading, btnPrimary, btnSecondary, inputCls } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { ConfidentialNote } from '../components/ui'

const EMPTY = {
  title: '', type_id: '', counterparty: '', owner_id: '', backup_owner_id: '', department: '',
  status: 'draft', effective_date: '', signed_date: '', expiration_date: '', evergreen: false,
  binding_status: 'binding', sensitivity: 'standard', governing_law: '', tags: '', notes: '',
  renewal_type: 'none', renewal_term: '', notice_period_days: 0, termination_for_convenience: '', termination_notice_days: '',
  value_amount: '', currency: 'USD', payment_terms: '', billing_frequency: '', budget_code: '',
  parent_id: '', amends_id: '', superseded_by_id: '', reminders_enabled: true, details: {}, provisions: {},
  // Fields from the existing tracking sheet
  system_name: '', department_manager: '', annual_amount: '', annual_amount_note: '', mission_justification: '',
  initial_contract_date: '', initial_signer: '', last_renewal_date: '', notice_terms: '', administrators: '',
  corporate_license: '', google_sso: '', pricing_info: '', vendor_contact_note: '',
}

const nz = v => (v === '' || v === undefined ? null : (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v))
// yes / no / unknown <-> true / false / null (kept as '' | 'true' | 'false' in the form)
const triIn = v => (v == null ? '' : String(v))
const triOut = v => (v === '' ? null : v === 'true')

export default function ContractForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [form, setForm] = useState({ ...EMPTY, owner_id: profile?.id || '' })
  const [ref, setRef] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([listTypes(), listCounterparties(), getDirectory(), listContracts(), id ? getContract(id) : null])
      .then(([types, counterparties, directory, contracts, existing]) => {
        setRef({ types, counterparties, directory, contracts })
        if (id) {
          if (!existing) throw new Error('Contract not found, or you do not have access to it.')
          setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(existing).map(([k, v]) => [k, v ?? EMPTY[k] ?? ''])),
            counterparty: existing.counterparty?.name || '', tags: (existing.tags || []).join(', '),
            termination_for_convenience: triIn(existing.termination_for_convenience),
            corporate_license: triIn(existing.corporate_license), google_sso: triIn(existing.google_sso) })
        } else {
          const first = types.find(t => t.form_kind === 'vendor') || types[0]
          setForm(f => ({ ...f, type_id: first?.id || '' }))
        }
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [id])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setDetail = (k, v) => setForm(f => ({ ...f, details: { ...f.details, [k]: v } }))
  const kind = ref?.types.find(t => t.id === form.type_id)?.form_kind || 'other'
  const d = form.details

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      if (!form.counterparty.trim()) throw new Error('Counterparty is required.')
      const counterparty_id = await findOrCreateCounterparty(form.counterparty)
      const fields = {
        title: form.title.trim(), type_id: form.type_id, counterparty_id, owner_id: form.owner_id,
        backup_owner_id: nz(form.backup_owner_id), department: form.department.trim(),
        effective_date: nz(form.effective_date), signed_date: nz(form.signed_date),
        expiration_date: nz(form.expiration_date), evergreen: form.evergreen,
        binding_status: form.binding_status, sensitivity: form.sensitivity, governing_law: nz(form.governing_law),
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean), notes: nz(form.notes),
        renewal_type: form.renewal_type, renewal_term: nz(form.renewal_term),
        notice_period_days: Number(form.notice_period_days) || 0,
        termination_for_convenience: form.termination_for_convenience === '' ? null : form.termination_for_convenience === 'true',
        termination_notice_days: nz(form.termination_notice_days) === null ? null : Number(form.termination_notice_days),
        value_amount: nz(form.value_amount) === null ? null : Number(form.value_amount), currency: nz(form.currency),
        payment_terms: nz(form.payment_terms), billing_frequency: nz(form.billing_frequency), budget_code: nz(form.budget_code),
        parent_id: nz(form.parent_id), amends_id: nz(form.amends_id), superseded_by_id: nz(form.superseded_by_id),
        reminders_enabled: form.reminders_enabled, details: form.details, provisions: form.provisions,
        system_name: nz(form.system_name), department_manager: nz(form.department_manager),
        annual_amount: nz(form.annual_amount) === null ? null : Number(form.annual_amount), annual_amount_note: nz(form.annual_amount_note),
        mission_justification: nz(form.mission_justification), initial_contract_date: nz(form.initial_contract_date),
        initial_signer: nz(form.initial_signer), last_renewal_date: nz(form.last_renewal_date), notice_terms: nz(form.notice_terms),
        administrators: nz(form.administrators), corporate_license: triOut(form.corporate_license), google_sso: triOut(form.google_sso),
        pricing_info: nz(form.pricing_info), vendor_contact_note: nz(form.vendor_contact_note),
        ...(id ? { status: form.status } : {}),
      }
      const saved = await saveContract(id, fields)
      navigate(`/contracts/${saved.id}`)
    } catch (err) {
      setError(err); window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally { setSaving(false) }
  }

  if (loading) return <Page title={id ? 'Edit contract' : 'New contract'}><Loading /></Page>
  if (!ref) return <Page title="Contract"><ErrorMsg error={error} /></Page>

  const text = (k, props = {}) => <input className={inputCls} value={form[k] ?? ''} onChange={e => set(k, e.target.value)} {...props} />
  const people = ref.directory.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)
  const others = ref.contracts.filter(c => c.id !== id)
  const contractOpts = others.map(c => <option key={c.id} value={c.id}>{c.title} — {c.counterparty?.name}</option>)

  return (
    <Page title={id ? 'Edit contract' : 'New contract'}>
      <ErrorMsg error={error} />
      <form onSubmit={submit}>
        <Card title="Basics">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Title" required className="md:col-span-2">{text('title', { required: true })}</Field>
            <Field label="System / product" hint="e.g. Zoom, Freshworks CRM — the thing the contract is for.">{text('system_name')}</Field>
            <Field label="Department manager">{text('department_manager')}</Field>
            <Field label="Contract type" required>
              <select className={inputCls} required value={form.type_id} onChange={e => set('type_id', e.target.value)}>
                {ref.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Counterparty" required hint="Pick an existing one to avoid duplicates, or type a new name.">
              <input className={inputCls} list="counterparties" required value={form.counterparty} onChange={e => set('counterparty', e.target.value)} />
              <datalist id="counterparties">{ref.counterparties.map(c => <option key={c.id} value={c.name} />)}</datalist>
            </Field>
            <Field label="Internal owner" required hint="Accountable person; receives this contract's reminders. Not listed? An admin adds them under Users & roles first.">
              <select className={inputCls} required value={form.owner_id} onChange={e => set('owner_id', e.target.value)}>
                <option value="">Select…</option>{people}
              </select>
            </Field>
            <Field label="Backup owner" hint="Also receives reminders, and escalations.">
              <select className={inputCls} value={form.backup_owner_id} onChange={e => set('backup_owner_id', e.target.value)}>
                <option value="">None</option>{people}
              </select>
            </Field>
            <Field label="Department / program" required>{text('department', { required: true })}</Field>
            {id && <Field label="Status" hint="Activating requires an uploaded executed original, plus effective and signed dates.">
              <select className={inputCls} value={form.status} onChange={e => set('status', e.target.value)}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>}
            <Field label="Binding status" required>
              <select className={inputCls} value={form.binding_status} onChange={e => set('binding_status', e.target.value)}>
                {Object.entries(BINDING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Visibility" hint="Restricted: only the owner, backup, named people, admins and auditors can see it.">
              <select className={inputCls} value={form.sensitivity} onChange={e => set('sensitivity', e.target.value)}>
                <option value="standard">Standard</option><option value="restricted">Restricted</option>
              </select>
            </Field>
            <Field label="Governing law / jurisdiction">{text('governing_law')}</Field>
            <Field label="Tags" hint="Comma-separated.">{text('tags')}</Field>
            <Field label="Notes" className="md:col-span-2"><textarea className={inputCls} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
          </div>
        </Card>

        <Card title="Dates and renewal">
          <div className="grid md:grid-cols-3 gap-4">
            <Field label="Initial contract date" hint="When the very first agreement was made.">{text('initial_contract_date', { type: 'date' })}</Field>
            <Field label="Initial contract signer">{text('initial_signer')}</Field>
            <Field label="Last renewal date">{text('last_renewal_date', { type: 'date' })}</Field>
            <Field label="Signed date (current term)">{text('signed_date', { type: 'date' })}</Field>
            <Field label="Effective date">{text('effective_date', { type: 'date' })}</Field>
            <Field label="Expiration / next renewal date" hint={form.evergreen ? 'Ignored while evergreen.' : 'The date the current term ends or renews.'}>{text('expiration_date', { type: 'date', disabled: form.evergreen })}</Field>
            <label className="flex items-center gap-2 text-sm md:col-span-3">
              <input type="checkbox" checked={form.evergreen} onChange={e => set('evergreen', e.target.checked)} /> Evergreen (no fixed end date)
            </label>
            <Field label="Renewal type">
              <select className={inputCls} value={form.renewal_type} onChange={e => set('renewal_type', e.target.value)}>
                {Object.entries(RENEWAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Renewal term" hint="e.g. 12 months">{text('renewal_term')}</Field>
            <Field label="Notice period (days)" hint="Days before expiry that notice of non-renewal/termination is due. Reminders count down to this deadline, not the expiry.">
              {text('notice_period_days', { type: 'number', min: 0 })}
            </Field>
            <Field label="Renewal notice terms (as written)" hint="e.g. “60 days written notice”. The number of days above drives the reminders.">{text('notice_terms')}</Field>
            <Field label="Termination for convenience?">
              <select className={inputCls} value={form.termination_for_convenience} onChange={e => set('termination_for_convenience', e.target.value)}>
                <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            </Field>
            {form.termination_for_convenience === 'true' && <Field label="Termination notice (days)">{text('termination_notice_days', { type: 'number', min: 0 })}</Field>}
            <label className="flex items-center gap-2 text-sm md:col-span-3">
              <input type="checkbox" checked={form.reminders_enabled} onChange={e => set('reminders_enabled', e.target.checked)} /> Send reminders for this contract
            </label>
          </div>
        </Card>

        {(kind === 'vendor' || kind === 'sow' || kind === 'other') && (
          <Card title="Financial">
            <ConfidentialNote />
            <div className="grid md:grid-cols-3 gap-4">
              <Field label="Annual amount (vendor license only)">{text('annual_amount', { type: 'number', step: '0.01', min: 0 })}</Field>
              <Field label="Annual amount: notes" hint="Anything that doesn't fit a number — fees, “internal”, “free?”, “donated”." className="md:col-span-2">{text('annual_amount_note')}</Field>
              <Field label="Total contract value">{text('value_amount', { type: 'number', step: '0.01', min: 0 })}</Field>
              <Field label="Currency">{text('currency', { maxLength: 3 })}</Field>
              <Field label="Billing frequency">{text('billing_frequency')}</Field>
              <Field label="Payment terms">{text('payment_terms')}</Field>
              <Field label="Budget code / cost center">{text('budget_code')}</Field>
            </div>
          </Card>
        )}

        {(kind === 'vendor' || kind === 'other') && (
          <Card title="System and subscription details">
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Why this software advances our mission" hint="One paragraph." className="md:col-span-2">
                <textarea className={inputCls} rows={4} value={form.mission_justification} onChange={e => set('mission_justification', e.target.value)} />
              </Field>
              <Field label="Administrator(s)" hint="Names or email addresses.">{text('administrators')}</Field>
              <Field label="More information / pricing">{text('pricing_info')}</Field>
              <Field label="Corporate (organization-wide) license?">
                <select className={inputCls} value={form.corporate_license} onChange={e => set('corporate_license', e.target.value)}>
                  <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select>
              </Field>
              <Field label="Uses Google sign-in?">
                <select className={inputCls} value={form.google_sso} onChange={e => set('google_sso', e.target.value)}>
                  <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select>
              </Field>
              <Field label="Vendor contact rule" hint="e.g. “Do not contact the vendor without speaking to the department manager.”" className="md:col-span-2">{text('vendor_contact_note')}</Field>
            </div>
          </Card>
        )}

        {kind === 'mou' && (
          <Card title="MOU details">
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Purpose" className="md:col-span-2"><textarea className={inputCls} rows={2} value={d.purpose || ''} onChange={e => setDetail('purpose', e.target.value)} /></Field>
              <Field label="Expected next step" hint="e.g. definitive agreement"><input className={inputCls} value={d.next_step || ''} onChange={e => setDetail('next_step', e.target.value)} /></Field>
              <Field label="Target date"><input type="date" className={inputCls} value={d.target_date || ''} onChange={e => setDetail('target_date', e.target.value)} /></Field>
              <Field label="Binding clauses" hint="e.g. confidentiality, exclusivity" className="md:col-span-2"><input className={inputCls} value={d.binding_clauses || ''} onChange={e => setDetail('binding_clauses', e.target.value)} /></Field>
            </div>
          </Card>
        )}
        {kind === 'sow' && (
          <Card title="SOW details">
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Project name"><input className={inputCls} value={d.project_name || ''} onChange={e => setDetail('project_name', e.target.value)} /></Field>
              <Field label="Parent agreement (MSA)">
                <select className={inputCls} value={form.parent_id} onChange={e => set('parent_id', e.target.value)}><option value="">None</option>{contractOpts}</select>
              </Field>
              <Field label="Deliverables summary" className="md:col-span-2"><textarea className={inputCls} rows={2} value={d.deliverables || ''} onChange={e => setDetail('deliverables', e.target.value)} /></Field>
              <p className="text-xs text-gray-400 md:col-span-2">Add milestones (date + description) on the contract page after saving.</p>
            </div>
          </Card>
        )}
        {kind === 'vendor' && (
          <Card title="Vendor details">
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Vendor contact"><input className={inputCls} value={d.vendor_contact || ''} onChange={e => setDetail('vendor_contact', e.target.value)} /></Field>
              <Field label="Insurance / compliance certificate expiry"><input type="date" className={inputCls} value={d.insurance_expiry || ''} onChange={e => setDetail('insurance_expiry', e.target.value)} /></Field>
              <Field label="SLA summary" className="md:col-span-2"><textarea className={inputCls} rows={2} value={d.sla_summary || ''} onChange={e => setDetail('sla_summary', e.target.value)} /></Field>
              <Field label="Parent agreement (MSA)">
                <select className={inputCls} value={form.parent_id} onChange={e => set('parent_id', e.target.value)}><option value="">None</option>{contractOpts}</select>
              </Field>
              <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={!!d.data_protection_terms} onChange={e => setDetail('data_protection_terms', e.target.checked)} /> Data-protection terms present</label>
            </div>
          </Card>
        )}

        <Card title="Relationships and provisions">
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            {kind === 'other' && <Field label="Parent agreement"><select className={inputCls} value={form.parent_id} onChange={e => set('parent_id', e.target.value)}><option value="">None</option>{contractOpts}</select></Field>}
            <Field label="This is an amendment to" hint="Links to the contract it amends."><select className={inputCls} value={form.amends_id} onChange={e => set('amends_id', e.target.value)}><option value="">Not an amendment</option>{contractOpts}</select></Field>
            <Field label="Superseded by"><select className={inputCls} value={form.superseded_by_id} onChange={e => set('superseded_by_id', e.target.value)}><option value="">Not superseded</option>{contractOpts}</select></Field>
          </div>
          <p className="text-xs font-semibold text-gray-600 mb-2">Provisions present (optional)</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {PROVISIONS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!form.provisions[k]} onChange={e => set('provisions', { ...form.provisions, [k]: e.target.checked })} /> {label}
              </label>
            ))}
          </div>
        </Card>

        <div className="flex gap-2">
          <button className={btnPrimary} disabled={saving}>{saving ? 'Saving…' : id ? 'Save changes' : 'Create contract'}</button>
          <Link className={btnSecondary} to={id ? `/contracts/${id}` : '/contracts'}>Cancel</Link>
        </div>
        {!id && <p className="text-xs text-gray-400 mt-3">New contracts start as a draft. Upload the executed original on the next page, then set the status to Active.</p>}
      </form>
    </Page>
  )
}
