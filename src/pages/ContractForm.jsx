import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { FileText, DollarSign, CalendarDays, Settings2, ListChecks, MoreHorizontal } from 'lucide-react'
import { getContract, listTypes, listCounterparties, getDirectory, listContracts, findOrCreateCounterparty, saveContract, addSignatory } from '../lib/contracts'
import { STATUS_LABELS, RENEWAL_LABELS, SIGN_ON_LABELS } from '../lib/format'
import { Page, Card, SectionNav, Field, ErrorMsg, Loading, btnPrimary, btnSecondary, inputCls } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { ConfidentialNote } from '../components/ui'

const EMPTY = {
  title: '', type_id: '', counterparty: '', owner_id: '', department: '',
  status: 'draft', effective_date: '', signed_date: '', expiration_date: '', evergreen: false,
  sensitivity: 'standard', tags: '', notes: '',
  renewal_type: 'none', renewal_term: '', notice_period_days: 30, termination_for_convenience: '', termination_notice_days: '',
  value_amount: '', currency: 'USD', payment_terms: '', billing_frequency: '', budget_code: '',
  details: {},
  // Fields from the existing tracking sheet
  system_name: '', annual_amount: '', annual_amount_note: '', mission_justification: '',
  signatory_name: '', signatory_email: '', last_renewal_date: '', administrators: '',
  corporate_license: '', sign_on_methods: [], pricing_info: '', vendor_contact_note: '',
  // New data-element list (2026-11-09)
  custom_msa: false,
  // Notification requirements (2026-11-11)
  termination_date: '',
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
            counterparty: existing.counterparty?.name || '', tags: (existing.tags || []).join(', '), details: existing.details || {},
            termination_for_convenience: triIn(existing.termination_for_convenience),
            corporate_license: triIn(existing.corporate_license), sign_on_methods: existing.sign_on_methods || [] })
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
      if (!form.counterparty.trim()) throw new Error('Vendor is required.')
      if (form.expiration_date && form.effective_date && form.expiration_date < form.effective_date) {
        throw new Error('Expiration / next renewal date cannot be before the start date.')
      }
      const counterparty_id = await findOrCreateCounterparty(form.counterparty)
      const fields = {
        title: form.title.trim(), type_id: form.type_id, counterparty_id, owner_id: form.owner_id,
        department: form.department.trim(),
        effective_date: nz(form.effective_date), signed_date: nz(form.signed_date),
        expiration_date: nz(form.expiration_date), evergreen: form.evergreen,
        sensitivity: form.sensitivity,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean), notes: nz(form.notes),
        renewal_type: form.renewal_type, renewal_term: nz(form.renewal_term),
        notice_period_days: Number(form.notice_period_days) || 0,
        termination_for_convenience: form.termination_for_convenience === '' ? null : form.termination_for_convenience === 'true',
        termination_notice_days: nz(form.termination_notice_days) === null ? null : Number(form.termination_notice_days),
        value_amount: nz(form.value_amount) === null ? null : Number(form.value_amount), currency: nz(form.currency),
        payment_terms: nz(form.payment_terms), billing_frequency: nz(form.billing_frequency), budget_code: nz(form.budget_code),
        // Reminders always run now — there's no per-contract opt-out any more.
        reminders_enabled: true, details: form.details,
        system_name: nz(form.system_name),
        annual_amount: nz(form.annual_amount) === null ? null : Number(form.annual_amount), annual_amount_note: nz(form.annual_amount_note),
        mission_justification: nz(form.mission_justification),
        // Signatory is written here only on creation, to seed day one; after that it's a cache kept
        // in sync from contract_signatories (see Signatory history on the contract page), not editable here.
        ...(id ? {} : { signatory_name: nz(form.signatory_name), signatory_email: nz(form.signatory_email) }),
        last_renewal_date: nz(form.last_renewal_date),
        administrators: nz(form.administrators), corporate_license: triOut(form.corporate_license), sign_on_methods: form.sign_on_methods,
        pricing_info: nz(form.pricing_info), vendor_contact_note: nz(form.vendor_contact_note),
        custom_msa: form.custom_msa,
        termination_date: nz(form.termination_date),
        ...(id ? { status: form.status } : {}),
        // Backup owner, department manager (+ email), contract length, the written-out renewal/notice
        // terms and the initial contract date are no longer editable here (visual-refresh redesign,
        // 2026-11-19) — omitted rather than sent as null, so existing values on an edited contract are
        // left exactly as they are; they just can't be set or changed through this form any more.
      }
      const saved = await saveContract(id, fields)
      if (!id && form.signatory_name.trim()) {
        // Best-effort: the contract itself is already saved with this as its initial signatory_name/
        // email, so a failure here only costs the dated history entry, not the data.
        try {
          await addSignatory(saved.id, {
            name: form.signatory_name.trim(), email: nz(form.signatory_email),
            start_date: new Date().toISOString().slice(0, 10),
          }, profile?.id)
        } catch (x) { console.error('could not record the initial signatory history entry', x) }
      }
      navigate(`/contracts/${saved.id}`)
    } catch (err) {
      setError(err); window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally { setSaving(false) }
  }

  if (loading) return <Page title={id ? 'Edit contract' : 'New contract'}><Loading /></Page>
  if (!ref) return <Page title="Contract"><ErrorMsg error={error} /></Page>

  const text = (k, props = {}) => <input className={inputCls} value={form[k] ?? ''} onChange={e => set(k, e.target.value)} {...props} />
  const people = ref.directory.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)
  const departments = [...new Set(ref.contracts.map(c => c.department).filter(Boolean))].sort()

  const typeDetailsLabel = { mou: 'MOU details', sow: 'SOW details' }[kind]
  const showFinancial = kind === 'vendor' || kind === 'sow' || kind === 'other'
  const showAdministration = kind === 'vendor' || kind === 'other'
  const navItems = [
    { id: 'basics', label: 'Basics' },
    { id: 'financial', label: 'Financial', show: showFinancial },
    { id: 'dates', label: 'Dates and renewal' },
    { id: 'administration', label: 'Administration', show: showAdministration },
    { id: 'type-details', label: typeDetailsLabel, show: !!typeDetailsLabel },
    { id: 'more', label: 'More' },
  ]

  return (
    <Page title={id ? 'Edit contract' : 'New contract'}>
      <ErrorMsg error={error} />
      <div className="md:flex md:gap-8 md:items-start">
        <SectionNav items={navItems} orientation="left" title={id ? form.title : undefined} />
        <div className="flex-1 min-w-0">
      <form onSubmit={submit}>
        <Card title="Basics" id="basics" icon={FileText}>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Title" required className="md:col-span-2">{text('title', { required: true })}</Field>
            <Field label="Contract type" required>
              <select className={inputCls} required value={form.type_id} onChange={e => set('type_id', e.target.value)}>
                {ref.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Vendor" required hint="Pick an existing one to avoid duplicates, or type a new name.">
              <input className={inputCls} list="counterparties" required value={form.counterparty} onChange={e => set('counterparty', e.target.value)} />
              <datalist id="counterparties">{ref.counterparties.map(c => <option key={c.id} value={c.name} />)}</datalist>
            </Field>
            <Field label="Vendor contact" hint="A name at the vendor."><input className={inputCls} value={d.vendor_contact || ''} onChange={e => setDetail('vendor_contact', e.target.value)} /></Field>
            <Field label="Vendor email"><input type="email" className={inputCls} value={d.vendor_email || ''} onChange={e => setDetail('vendor_email', e.target.value)} /></Field>
            <Field label="Internal owner" required hint="Accountable person; receives this contract's reminders. Not listed? An admin adds them under Users & roles first.">
              <select className={inputCls} required value={form.owner_id} onChange={e => set('owner_id', e.target.value)}>
                <option value="">Select…</option>{people}
              </select>
            </Field>
            <Field label="Department / program" required hint="Pick an existing one, or type a new name.">
              <input className={inputCls} list="departments" required value={form.department} onChange={e => set('department', e.target.value)} />
              <datalist id="departments">{departments.map(d => <option key={d} value={d} />)}</datalist>
            </Field>
            <Field label="System / product" hint="e.g. Zoom, Freshworks CRM — the thing the contract is for.">{text('system_name')}</Field>
            {id && <Field label="Status" hint="Activating requires an uploaded executed original, plus effective and signed dates.">
              <select className={inputCls} value={form.status} onChange={e => set('status', e.target.value)}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>}
            <label className="flex items-center gap-2 text-sm self-end pb-2">
              <input type="checkbox" checked={form.sensitivity === 'restricted'} onChange={e => set('sensitivity', e.target.checked ? 'restricted' : 'standard')} /> Restricted
            </label>
            {(kind === 'vendor' || kind === 'other') && (
              <Field label="Rationale: Why this software advances our mission" required hint="One paragraph." className="md:col-span-2">
                <textarea className={inputCls} rows={4} required value={form.mission_justification} onChange={e => set('mission_justification', e.target.value)} />
              </Field>
            )}
          </div>
        </Card>

        {showFinancial && (
          <Card title="Financial" id="financial" icon={DollarSign}>
            <ConfidentialNote />
            <div className="grid md:grid-cols-3 gap-4">
              <Field label="Annual amount (vendor license only)" required>{text('annual_amount', { type: 'number', step: '0.01', min: 0, required: true })}</Field>
              <Field label="Annual amount: notes" hint="Anything that doesn't fit a number — fees, “internal”, “free?”, “donated”." className="md:col-span-2">{text('annual_amount_note')}</Field>
              <Field label="Total contract value">{text('value_amount', { type: 'number', step: '0.01', min: 0 })}</Field>
              <Field label="Currency">{text('currency', { maxLength: 3 })}</Field>
              <Field label="Billing frequency">{text('billing_frequency')}</Field>
              <Field label="Payment terms">{text('payment_terms')}</Field>
              <Field label="Budget code / cost center">{text('budget_code')}</Field>
            </div>
          </Card>
        )}

        <Card title="Dates and renewal" id="dates" icon={CalendarDays}>
          <div className="grid md:grid-cols-3 gap-4">
            <Field label="Signer" required={!id} hint={id ? 'Current signatory — add a dated change via Signatory history on the contract page, not here.' : undefined}>
              {text('signatory_name', { required: !id, disabled: !!id })}
            </Field>
            <Field label="Signer email" required={!id}>
              {text('signatory_email', { type: 'email', required: !id, disabled: !!id })}
            </Field>
            <Field label="Signed date (current term)" required>{text('signed_date', { type: 'date', required: true })}</Field>
            <Field label="Start date" required>{text('effective_date', { type: 'date', required: true })}</Field>
            <Field label="Last renewal date">{text('last_renewal_date', { type: 'date' })}</Field>
            <Field label="Expiration / next renewal date" required={!form.evergreen} hint={form.evergreen ? 'Ignored while evergreen.' : 'The date the current term ends or renews.'}>{text('expiration_date', { type: 'date', min: form.effective_date || undefined, disabled: form.evergreen, required: !form.evergreen })}</Field>
            <label className="flex items-center gap-2 text-sm self-end pb-2">
              <input type="checkbox" checked={form.evergreen} onChange={e => set('evergreen', e.target.checked)} /> Evergreen (no fixed end date)
            </label>
            <Field label="Renewal type">
              <select className={inputCls} value={form.renewal_type} onChange={e => set('renewal_type', e.target.value)}>
                {Object.entries(RENEWAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Renewal term" hint="e.g. 12 months">{text('renewal_term')}</Field>
            <Field label="Notice period (days)" required hint="Days before expiry that notice of non-renewal/termination is due. Reminders count down to this deadline, not the expiry.">
              {text('notice_period_days', { type: 'number', min: 0, required: true })}
            </Field>
            <Field label="Termination for convenience?">
              <select className={inputCls} value={form.termination_for_convenience} onChange={e => set('termination_for_convenience', e.target.value)}>
                <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            </Field>
            {form.termination_for_convenience === 'true' && <Field label="Termination notice period (days)">{text('termination_notice_days', { type: 'number', min: 0 })}</Field>}
            <Field label="Termination date" hint="What actually happened: when this contract was confirmed terminated or not renewed. Leave blank until that's decided.">{text('termination_date', { type: 'date' })}</Field>
          </div>
        </Card>

        {showAdministration && (
          <Card title="Administration" id="administration" icon={Settings2}>
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Administrator(s)" hint="Names or email addresses.">{text('administrators')}</Field>
              <Field label="More information / pricing">{text('pricing_info')}</Field>
              <Field label="Corporate (organization-wide) license?">
                <select className={inputCls} value={form.corporate_license} onChange={e => set('corporate_license', e.target.value)}>
                  <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select>
              </Field>
              <div>
                <span className="block text-xs font-semibold text-gray-600 mb-1">Sign-on method</span>
                <div className="flex items-center gap-4 pt-1.5">
                  {Object.entries(SIGN_ON_LABELS).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={form.sign_on_methods.includes(k)}
                        onChange={e => set('sign_on_methods', e.target.checked
                          ? [...form.sign_on_methods, k] : form.sign_on_methods.filter(m => m !== k))} /> {label}
                    </label>
                  ))}
                </div>
              </div>
              <Field label="Vendor contact rule" hint="e.g. “Do not contact the vendor without speaking to the department manager.”" className="md:col-span-2">{text('vendor_contact_note')}</Field>
              <label className="flex items-center gap-2 text-sm self-end pb-2">
                <input type="checkbox" checked={form.custom_msa} onChange={e => set('custom_msa', e.target.checked)} /> Custom MSA
              </label>
              {form.custom_msa && (
                <p className="text-xs text-amber-700 md:col-span-2">
                  A copy of the MSA must be attached under Documents (type “MSA copy”) before this contract can be made Active.
                </p>
              )}
            </div>
          </Card>
        )}

        {kind === 'mou' && (
          <Card title="MOU details" id="type-details" icon={ListChecks}>
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Purpose" className="md:col-span-2"><textarea className={inputCls} rows={2} value={d.purpose || ''} onChange={e => setDetail('purpose', e.target.value)} /></Field>
              <Field label="Expected next step" hint="e.g. definitive agreement"><input className={inputCls} value={d.next_step || ''} onChange={e => setDetail('next_step', e.target.value)} /></Field>
              <Field label="Target date"><input type="date" className={inputCls} value={d.target_date || ''} onChange={e => setDetail('target_date', e.target.value)} /></Field>
              <Field label="Binding clauses" hint="e.g. confidentiality, exclusivity" className="md:col-span-2"><input className={inputCls} value={d.binding_clauses || ''} onChange={e => setDetail('binding_clauses', e.target.value)} /></Field>
            </div>
          </Card>
        )}
        {kind === 'sow' && (
          <Card title="SOW details" id="type-details" icon={ListChecks}>
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Project name"><input className={inputCls} value={d.project_name || ''} onChange={e => setDetail('project_name', e.target.value)} /></Field>
              <Field label="Deliverables summary" className="md:col-span-2"><textarea className={inputCls} rows={2} value={d.deliverables || ''} onChange={e => setDetail('deliverables', e.target.value)} /></Field>
              <p className="text-xs text-gray-400 md:col-span-2">Add milestones (date + description) on the contract page after saving.</p>
            </div>
          </Card>
        )}

        <Card title="More" id="more" icon={MoreHorizontal}>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Tags" hint="Comma-separated.">{text('tags')}</Field>
            <Field label="Notes" className="md:col-span-2"><textarea className={inputCls} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
          </div>
        </Card>

        <div className="flex gap-2">
          <button className={btnPrimary} disabled={saving}>{saving ? 'Saving…' : id ? 'Save changes' : 'Create contract'}</button>
          <Link className={btnSecondary} to={id ? `/contracts/${id}` : '/contracts'}>Cancel</Link>
        </div>
        {!id && <p className="text-xs text-gray-400 mt-3">New contracts start as a draft. Upload the executed original on the next page, then set the status to Active.</p>}
      </form>
        </div>
      </div>
    </Page>
  )
}
