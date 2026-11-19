import { useEffect, useState } from 'react'
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom'
import { Pencil, ExternalLink } from 'lucide-react'
import {
  getContract, listTypes, listCounterparties, getDirectory, listContracts, findOrCreateCounterparty,
  saveContract, addSignatory,
} from '../lib/contracts'
import { listDocuments, uploadDocument, openDocument, MAX_BYTES } from '../lib/documents'
import { fmtDate, fmtDateTime, fmtMoney, fmtBytes, daysUntil, STATUS_LABELS, RENEWAL_LABELS, SIGN_ON_LABELS, PROVISIONS } from '../lib/format'
import { Page, SectionNav, StatusBadge, ErrorMsg, Loading, ConfidentialNote, Field, btnPrimary, btnSecondary, inputCls } from '../components/ui'
import {
  DocumentsPanel, DecisionPanel, MilestonesPanel, LinksPanel, AccessPanel, RelationshipsPanel, SignatoriesPanel, HistoryPanel,
} from '../components/contract/panels'
import { useAuth, useCan } from '../context/AuthContext'

// One page for creating, viewing and editing a contract. The layout is the same in every mode:
// view mode shows each field as text, edit mode swaps the same field for an input. The
// "Essentials" card up top is the quick-add; everything below it can be filled in later.

const EMPTY = {
  title: '', type_id: '', counterparty: '', owner_id: '', backup_owner_id: '',
  status: 'draft', effective_date: '', signed_date: '', expiration_date: '', evergreen: false,
  sensitivity: 'standard', tags: '', notes: '',
  renewal_type: 'none', renewal_term: '', notice_period_days: '', termination_for_convenience: '', termination_notice_days: '',
  value_amount: '', currency: 'USD', payment_terms: '', billing_frequency: '', budget_code: '',
  amends_id: '', superseded_by_id: '', reminders_enabled: true, details: {}, provisions: {},
  system_name: '', counterparty_signer_name: '', counterparty_signed_date: '', annual_amount: '', annual_amount_note: '', mission_justification: '',
  initial_contract_date: '', signatory_name: '', signatory_email: '', last_renewal_date: '', notice_terms: '', administrators: '',
  corporate_license: '', sign_on_methods: [], pricing_info: '', vendor_contact_note: '',
  no_original_exception: false, no_original_reason: '',
  contract_length_years: '', custom_msa: false,
  termination_date: '', amended_date: '', amendment_description: '',
}

const nz = v => (v === '' || v === undefined ? null : (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v))
const num = v => (nz(v) === null ? null : Number(v))
// yes / no / unknown <-> true / false / null (kept as '' | 'true' | 'false' in the form)
const triIn = v => (v == null ? '' : String(v))
const triOut = v => (v === '' ? null : v === 'true')
const TRI = [['', 'Unknown'], ['true', 'Yes'], ['false', 'No']]
const triLabel = v => (v === 'true' ? 'Yes' : v === 'false' ? 'No' : '')
const isEmpty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0)

function toForm(existing) {
  return {
    ...EMPTY,
    ...Object.fromEntries(Object.entries(existing).map(([k, v]) => [k, v ?? EMPTY[k] ?? ''])),
    counterparty: existing.counterparty?.name || '', tags: (existing.tags || []).join(', '),
    termination_for_convenience: triIn(existing.termination_for_convenience),
    corporate_license: triIn(existing.corporate_license), sign_on_methods: existing.sign_on_methods || [],
  }
}

function addDays(iso, delta) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

function Group({ title, children, note }) {
  return (
    <div className="min-w-0">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-brand border-b border-gray-200 pb-1.5 mb-3">{title}</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</div>
      {note && <p className="text-xs text-gray-500 mt-3">{note}</p>}
    </div>
  )
}

function Section({ id, title, hint, children, essentials }) {
  return (
    <section id={id} className={`bg-white rounded-xl shadow-sm border p-5 mb-5 scroll-mt-4 ${essentials ? 'border-brand/50 ring-4 ring-brand/10' : 'border-gray-100'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-3">
        <h2 className={`font-semibold text-gray-800 ${essentials ? 'text-lg' : ''}`}>{title}</h2>
        {hint && <span className="text-xs text-gray-500">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

export default function ContractPage({ edit = false }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { profile, contractRole } = useAuth()
  const can = useCan()
  const [form, setForm] = useState({ ...EMPTY, owner_id: profile?.id || '' })
  const [contract, setContract] = useState(null)
  const [docs, setDocs] = useState([])
  const [ref, setRef] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(location.state?.uploadError ? new Error(location.state.uploadError) : null)
  const [pendingFile, setPendingFile] = useState(null)
  const [version, setVersion] = useState(0)
  const [sectionVisible, setSectionVisible] = useState({})
  const setVisible = key => v => setSectionVisible(s => (s[key] === v ? s : { ...s, [key]: v }))

  useEffect(() => {
    Promise.all([listTypes(), listCounterparties(), getDirectory(), listContracts(), id ? getContract(id) : null, id ? listDocuments(id) : []])
      .then(([types, counterparties, directory, contracts, existing, documents]) => {
        setRef({ types, counterparties, directory, contracts })
        setDocs(documents)
        if (id) {
          if (!existing) throw new Error('Contract not found, or you do not have access to it.')
          setContract(existing); setForm(toForm(existing))
        } else {
          const first = types.find(t => t.form_kind === 'vendor') || types[0]
          setForm(f => ({ ...f, type_id: first?.id || '' }))
        }
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [id, version])

  const title = id ? (form.title || 'Contract') : 'New contract'
  if (loading) return <Page title={title}><Loading /></Page>
  if (!ref) return <Page title="Contract"><ErrorMsg error={error} /></Page>

  const canEdit = !id || contractRole === 'admin' || (contractRole === 'contributor' && (contract.owner_id === profile?.id || contract.backup_owner_id === profile?.id))
  const editing = edit && canEdit
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setDetail = (k, v) => setForm(f => ({ ...f, details: { ...f.details, [k]: v } }))
  const kind = ref.types.find(t => t.id === form.type_id)?.form_kind || 'other'
  const d = form.details || {}
  // "Vendor" fits a vendor contract; for an MOU or SOW the same field is simply the other party.
  const party = kind === 'vendor' ? 'Vendor' : 'Other party'
  const nameOf = pid => ref.directory.find(p => p.id === pid)?.display_name
  const people = ref.directory.map(p => [p.id, p.display_name])
  const contractOpts = ref.contracts.filter(c => c.id !== id).map(c => [c.id, `${c.title} — ${c.counterparty?.name}`])
  const originals = docs.filter(x => x.role === 'original').sort((a, b) => b.version - a.version)
  const latestOriginal = originals[0]

  const deadline = editing || !contract
    ? (!form.evergreen && form.expiration_date && form.notice_period_days !== '' ? addDays(form.expiration_date, -Number(form.notice_period_days)) : null)
    : contract.notice_deadline
  const days = daysUntil(contract?.notice_deadline)

  // A field: text in view mode, an input in edit mode. Same slot, same label.
  function fld(k, label, o = {}) {
    const { type = 'text', req, hint, cls = '', area, options, view, step, min, disabled, maxLength, noBlank } = o
    const v = form[k]
    if (!editing) {
      let shown = view ? view(v, form) : (options ? options.find(([val]) => val === v)?.[1] : v)
      const blank = isEmpty(shown)
      return (
        <div key={k} className={`min-w-0 ${cls}`}>
          <dt className="block text-xs font-semibold text-gray-600 mb-1">{label}</dt>
          <dd className={`text-sm min-h-[2.25rem] py-1.5 break-words whitespace-pre-wrap ${blank ? (req ? 'text-amber-700' : 'text-gray-300') : 'text-gray-900'}`}>
            {blank ? (req ? 'Not entered yet' : '—') : shown}
          </dd>
        </div>
      )
    }
    let control
    if (options) {
      control = (
        <select className={inputCls} required={req} disabled={disabled} value={v} onChange={e => set(k, e.target.value)}>
          {!noBlank && !options.some(([val]) => val === '') && <option value="">Select…</option>}
          {options.map(([val, text]) => <option key={val} value={val}>{text}</option>)}
        </select>
      )
    } else if (area) {
      control = <textarea className={inputCls} rows={area} required={req} value={v} onChange={e => set(k, e.target.value)} />
    } else {
      control = <input className={inputCls} type={type} step={step} min={min} maxLength={maxLength} required={req} disabled={disabled} value={v ?? ''} onChange={e => set(k, e.target.value)} />
    }
    return <Field key={k} label={label} required={req} hint={hint} className={cls}>{control}</Field>
  }

  const check = (label, k, hint) => (editing
    ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} /> {label}</label>
    : null)

  function pickOriginal(file) {
    if (!file) return setPendingFile(null)
    if (file.type !== 'application/pdf') { setError(new Error('The executed original must be a PDF.')); return }
    if (file.size > MAX_BYTES) { setError(new Error('Files must be 50 MB or smaller.')); return }
    setError(null); setPendingFile(file)
  }

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      if (!form.counterparty.trim()) throw new Error('Vendor is required.')
      if (can.admin && form.no_original_exception && !form.no_original_reason.trim()) {
        throw new Error('A reason is required to mark the original as not on file.')
      }
      const counterparty_id = await findOrCreateCounterparty(form.counterparty)
      const fields = {
        title: form.title.trim(), type_id: form.type_id, counterparty_id, owner_id: form.owner_id,
        backup_owner_id: nz(form.backup_owner_id),
        effective_date: nz(form.effective_date), signed_date: nz(form.signed_date),
        expiration_date: nz(form.expiration_date), evergreen: form.evergreen,
        sensitivity: form.sensitivity,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean), notes: nz(form.notes),
        renewal_type: form.renewal_type, renewal_term: nz(form.renewal_term),
        notice_period_days: Number(form.notice_period_days) || 0,
        termination_for_convenience: triOut(form.termination_for_convenience),
        termination_notice_days: num(form.termination_notice_days),
        value_amount: num(form.value_amount), currency: nz(form.currency),
        payment_terms: nz(form.payment_terms), billing_frequency: nz(form.billing_frequency), budget_code: nz(form.budget_code),
        amends_id: nz(form.amends_id), superseded_by_id: nz(form.superseded_by_id),
        reminders_enabled: form.reminders_enabled, details: form.details, provisions: form.provisions,
        system_name: nz(form.system_name),
        counterparty_signer_name: nz(form.counterparty_signer_name), counterparty_signed_date: nz(form.counterparty_signed_date),
        annual_amount: num(form.annual_amount), annual_amount_note: nz(form.annual_amount_note),
        mission_justification: nz(form.mission_justification), initial_contract_date: nz(form.initial_contract_date),
        // Signatory is written here only on creation, to seed day one; after that it's a cache kept
        // in sync from contract_signatories (see Signatory history on the contract page), not editable here.
        ...(id ? {} : { signatory_name: nz(form.signatory_name), signatory_email: nz(form.signatory_email) }),
        last_renewal_date: nz(form.last_renewal_date), notice_terms: nz(form.notice_terms),
        administrators: nz(form.administrators), corporate_license: triOut(form.corporate_license), sign_on_methods: form.sign_on_methods,
        pricing_info: nz(form.pricing_info), vendor_contact_note: nz(form.vendor_contact_note),
        contract_length_years: num(form.contract_length_years),
        custom_msa: form.custom_msa,
        termination_date: nz(form.termination_date), amended_date: nz(form.amended_date),
        amendment_description: nz(form.amendment_description),
        ...(id ? { status: form.status } : {}),
        // Only admins may grant/revoke this (enforced in the DB too); leaving these out of
        // the payload for non-admins keeps their edits from touching an existing exception.
        ...(can.admin ? { no_original_exception: form.no_original_exception, no_original_reason: nz(form.no_original_reason) } : {}),
      }
      const saved = await saveContract(id, fields)
      if (!id && form.signatory_name.trim()) {
        // Best-effort: the contract itself is already saved with this as its initial signatory_name/
        // email, so a failure here only costs the dated history entry, not the data.
        try {
          await addSignatory(saved.id, {
            name: form.signatory_name.trim(), email: nz(form.signatory_email),
            start_date: form.initial_contract_date || form.effective_date || new Date().toISOString().slice(0, 10),
          }, profile?.id)
        } catch (x) { console.error('could not record the initial signatory history entry', x) }
      }
      if (pendingFile) {
        // The contract is already saved; if the upload fails, land back on the edit page with the reason.
        try {
          await uploadDocument({
            contractId: saved.id, file: pendingFile, role: 'original', docKey: latestOriginal?.doc_key || null,
            changeNote: latestOriginal ? 'Replaced executed original' : 'Executed original',
          })
        } catch (x) {
          navigate(`/contracts/${saved.id}/edit`, { replace: true, state: { uploadError: `The contract was saved, but the signed original did not upload: ${x.message}` } })
          return
        }
      }
      navigate(`/contracts/${saved.id}`)
    } catch (err) {
      setError(err); window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally { setSaving(false) }
  }

  const saveLabel = saving ? 'Saving…' : id ? 'Save changes' : 'Create contract'
  const actions = editing
    ? <>
        <Link className={btnSecondary} to={id ? `/contracts/${id}` : '/contracts'}>Cancel</Link>
        <button className={btnPrimary} form="contract-form" disabled={saving}>{saveLabel}</button>
      </>
    : canEdit && id && <Link to={`/contracts/${id}/edit`} className={btnSecondary}><Pencil size={14} /> Edit</Link>

  const hasFinancialLater = editing || [form.annual_amount_note, form.currency, form.billing_frequency, form.payment_terms, form.budget_code].some(x => !isEmpty(x) && x !== 'USD')
  const typeLabel = { mou: 'MOU details', sow: 'SOW details', vendor: 'Vendor details' }[kind]
  const hasTypeDetails = !!typeLabel && (editing || Object.values(d).some(Boolean))
  const showSystem = kind === 'vendor' || kind === 'other'
  const provisionNames = PROVISIONS.filter(([k]) => form.provisions?.[k]).map(([, l]) => l)
  const hasDecision = !!id && contract?.status === 'active' && !!contract?.notice_deadline

  const navItems = [
    { id: 'decision', label: 'Renewal decision', show: hasDecision },
    { id: 'essentials', label: 'Essentials' },
    { id: 'ownership', label: 'Ownership & visibility' },
    { id: 'financial', label: 'Financial details', show: hasFinancialLater },
    { id: 'system', label: 'System & subscription', show: showSystem },
    { id: 'terms', label: 'Renewal & termination' },
    { id: 'type-details', label: typeLabel || 'Type details', show: hasTypeDetails },
    { id: 'related', label: 'Related & provisions' },
    { id: 'documents', label: 'Documents', show: !!id },
    { id: 'milestones', label: 'Milestones', show: !!id && (sectionVisible.milestones ?? true) },
    { id: 'links', label: 'Working-copy links', show: !!id && (sectionVisible.links ?? true) },
    { id: 'access', label: 'Access', show: !!id && contract?.sensitivity === 'restricted' },
    { id: 'signatories', label: 'Signatory history', show: !!id && (sectionVisible.signatories ?? true) },
    { id: 'relationships', label: 'Related contracts', show: !!id && (sectionVisible.relationships ?? true) },
    { id: 'history', label: 'History', show: !!id && can.seeAudit },
  ]

  const originalBlock = (
    <div className="min-w-0">
      <span className="block text-xs font-semibold text-gray-600 mb-1">Signed original</span>
      {editing ? (
        <>
          <label className="flex flex-col items-center justify-center gap-0.5 text-center min-h-[6rem] px-3 py-3 border-2 border-dashed border-gray-300 hover:border-brand rounded-lg cursor-pointer bg-white">
            <input type="file" accept="application/pdf" className="sr-only" onChange={e => pickOriginal(e.target.files[0])} />
            <strong className="text-sm text-gray-800 break-all">{pendingFile ? pendingFile.name : latestOriginal ? latestOriginal.filename : 'Choose the fully signed PDF'}</strong>
            <span className="text-xs text-gray-500">
              {pendingFile ? `${fmtBytes(pendingFile.size)} · uploads when you save`
                : latestOriginal ? 'Choose a different file to upload a new version' : 'PDF, up to 50 MB'}
            </span>
          </label>
          <span className="block text-xs text-gray-400 mt-1">Stored unaltered and cannot be deleted. A new upload is added as a new version. Needed before the contract can go Active.</span>
        </>
      ) : latestOriginal ? (
        <div className="bg-green-50 text-green-800 rounded-lg px-3 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="min-w-0 break-all"><strong>{latestOriginal.filename}</strong>
            <span className="block text-xs">Executed original on file · v{latestOriginal.version} · {fmtDateTime(latestOriginal.uploaded_at)}</span></div>
          <button type="button" className="ml-auto text-brand text-sm inline-flex items-center gap-1 hover:underline"
            onClick={() => openDocument(latestOriginal.id).catch(setError)}><ExternalLink size={14} /> Open</button>
        </div>
      ) : (
        <div className="bg-amber-50 text-amber-800 rounded-lg px-3 py-2 text-sm">
          <strong>{contract?.no_original_exception ? 'Not on file (admin exception)' : 'Not uploaded yet'}</strong>
          <span className="block text-xs">{contract?.no_original_exception ? contract.no_original_reason : 'Needed before this contract can go Active'}</span>
        </div>
      )}
    </div>
  )

  const form_ = (
    <form id="contract-form" onSubmit={submit}>
      <Section id="essentials" title="Essentials" essentials
        hint={editing ? 'Enough to get started. Everything below can be added later.' : undefined}>
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-6">
          <Group title="The contract">
            {fld('title', 'Title', { req: true, cls: 'col-span-2' })}
            {fld('type_id', 'Contract type', { req: true, noBlank: true, options: ref.types.map(t => [t.id, t.name]) })}
            {fld('owner_id', 'Internal owner', { req: true, options: people, view: v => nameOf(v), hint: 'Receives this contract’s reminders. Not listed? An admin adds them under Users & roles first.' })}
            {id && editing && fld('status', 'Status', { noBlank: true, options: Object.entries(STATUS_LABELS), hint: 'Active needs an executed original, plus effective and signed dates.' })}
          </Group>

          <Group title="Financial">
            {fld('annual_amount', 'Annual amount', { req: true, type: 'number', step: '0.01', min: 0,
              view: v => (v === '' ? '' : `${fmtMoney(v, form.currency)} (≈ $${Math.round(v / 1000)}k)`) })}
            {fld('value_amount', 'Total contract value', { type: 'number', step: '0.01', min: 0, view: v => (v === '' ? '' : fmtMoney(v, form.currency)) })}
            <div className="col-span-2"><ConfidentialNote /></div>
          </Group>

          <Group title="Signers" note={id && editing ? 'The SIL signer changes through Signatory history below, so there is one dated record of who was responsible when.' : undefined}>
            {editing ? (
              <Field label={party} required hint={kind === 'vendor' ? 'Pick an existing one to avoid duplicates, or type a new name.' : 'The organization that signs with SIL.'} className="col-span-2">
                <input className={inputCls} list="counterparties" required value={form.counterparty} onChange={e => set('counterparty', e.target.value)} />
                <datalist id="counterparties">{ref.counterparties.map(c => <option key={c.id} value={c.name} />)}</datalist>
              </Field>
            ) : fld('counterparty', party, { req: true, cls: 'col-span-2' })}
            {fld('signatory_name', id ? 'Current SIL signer' : 'SIL signer', { req: !id, disabled: !!id })}
            {fld('signed_date', 'SIL signed on', { req: true, type: 'date', view: v => v && fmtDate(v) })}
            {fld('signatory_email', 'SIL signer email', { req: !id, type: 'email', disabled: !!id, cls: 'col-span-2' })}
            {fld('counterparty_signer_name', `${party} signer`, { req: true })}
            {fld('counterparty_signed_date', `${party} signed on`, { req: true, type: 'date', view: v => v && fmtDate(v) })}
          </Group>

          <Group title="Dates">
            {fld('initial_contract_date', 'Initial contract date', { req: true, type: 'date', hint: 'When the very first agreement was made.', view: v => v && fmtDate(v) })}
            {fld('contract_length_years', 'Contract length (years)', { req: true, type: 'number', step: '0.1', min: 0,
              view: v => v !== '' && `${v} year${Number(v) === 1 ? '' : 's'}` })}
            {fld('effective_date', 'Effective date', { req: true, type: 'date', view: v => v && fmtDate(v) })}
            {fld('expiration_date', 'Expiration / next renewal date', { req: !form.evergreen, type: 'date', disabled: form.evergreen,
              view: (v, f) => (f.evergreen ? 'Evergreen — no fixed end date' : v && fmtDate(v)) })}
            {fld('notice_period_days', 'Notice period (days)', { req: true, type: 'number', min: 0,
              hint: 'Days before expiry that notice of non-renewal is due.',
              view: v => (v !== '' && Number(v) > 0 ? `${v} days` : form.expiration_date ? 'None (deadline is the expiry)' : '') })}
            {editing && <div className="col-span-2">{check('Evergreen (no fixed end date)', 'evergreen')}</div>}
            <div className="col-span-2 text-sm bg-brand/5 rounded-lg px-3 py-2">
              {deadline
                ? <>Last day to give notice: <strong>{fmtDate(deadline)}</strong>. Reminders count down to this date.</>
                : 'Enter an expiration date and notice period to see the last day to give notice.'}
            </div>
          </Group>
        </div>

        <div className="grid md:grid-cols-5 gap-x-8 gap-y-5 mt-6 pt-5 border-t border-gray-100">
          <div className="md:col-span-3 min-w-0">
            {fld('mission_justification', 'Rationale: Why this software advances our mission', { req: true, area: 4, hint: 'One paragraph, in plain language leadership would use.' })}
          </div>
          <div className="md:col-span-2 min-w-0">{originalBlock}</div>
        </div>
      </Section>

      <Section id="ownership" title="Ownership & visibility" hint="Add later">
        <div className="grid md:grid-cols-2 gap-4">
          {fld('backup_owner_id', 'Backup owner', { options: [['', 'None'], ...people], view: v => nameOf(v), hint: 'Also receives reminders, and escalations.' })}
          {fld('sensitivity', 'Visibility', { noBlank: true, options: [['standard', 'Standard'], ['restricted', 'Restricted']],
            hint: 'Restricted: only the owner, backup, named people, admins and auditors can see it.' })}
          {fld('tags', 'Tags', { hint: 'Comma-separated.' })}
          {editing
            ? <div className="self-end pb-2">{check('Send reminders for this contract', 'reminders_enabled')}</div>
            : fld('reminders_enabled', 'Reminders', { view: v => (v ? 'On' : 'Off') })}
          {(can.admin || form.no_original_exception) && (
            <div className="md:col-span-2 border-t border-gray-100 pt-3">
              {editing && can.admin ? (
                <>
                  <label className="flex items-center gap-2 text-sm mb-2">
                    <input type="checkbox" checked={form.no_original_exception} onChange={e => set('no_original_exception', e.target.checked)} />
                    Original not on file (admin only): allow this contract to become Active without an uploaded executed original
                  </label>
                  {form.no_original_exception && (
                    <Field label="Reason" required hint="Shown on the contract as a badge.">
                      <textarea className={inputCls} rows={2} required value={form.no_original_reason} onChange={e => set('no_original_reason', e.target.value)} />
                    </Field>
                  )}
                </>
              ) : (
                <dl>{fld('no_original_reason', 'Original not on file', {
                  view: v => v && `${v}${contract?.no_original_exception_set_by ? ` — set by ${nameOf(contract.no_original_exception_set_by)}` : ''}${contract?.no_original_exception_set_at ? ` on ${fmtDateTime(contract.no_original_exception_set_at)}` : ''}` })}</dl>
              )}
            </div>
          )}
        </div>
      </Section>

      {hasFinancialLater && (
        <Section id="financial" title="Financial details" hint="Add later">
          <div className="grid md:grid-cols-3 gap-4">
            {fld('annual_amount_note', 'Annual amount: notes', { cls: 'md:col-span-3', hint: 'Anything that doesn’t fit a number: fees, “internal”, “free?”, “donated”.' })}
            {fld('currency', 'Currency', { maxLength: 3 })}
            {fld('billing_frequency', 'Billing frequency')}
            {fld('payment_terms', 'Payment terms')}
            {fld('budget_code', 'Budget code / cost center')}
          </div>
        </Section>
      )}

      {showSystem && (
        <Section id="system" title="System & subscription" hint="Add later">
          <div className="grid md:grid-cols-2 gap-4">
            {fld('system_name', 'System / product', { hint: 'e.g. Zoom, Freshworks CRM: the thing the contract is for.' })}
            {fld('administrators', 'Administrator(s)', { hint: 'Names or email addresses.' })}
            {fld('pricing_info', 'More information / pricing')}
            {fld('corporate_license', 'Corporate (organization-wide) license?', { options: TRI, view: v => triLabel(v) })}
            <div className="min-w-0">
              <span className="block text-xs font-semibold text-gray-600 mb-1">Sign-on method</span>
              {editing ? (
                <div className="flex items-center gap-4 pt-1.5">
                  {Object.entries(SIGN_ON_LABELS).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={form.sign_on_methods.includes(k)}
                        onChange={e => set('sign_on_methods', e.target.checked ? [...form.sign_on_methods, k] : form.sign_on_methods.filter(m => m !== k))} /> {label}
                    </label>
                  ))}
                </div>
              ) : (
                <p className={`text-sm py-1.5 ${form.sign_on_methods.length ? 'text-gray-900' : 'text-gray-300'}`}>
                  {form.sign_on_methods.length ? form.sign_on_methods.map(m => SIGN_ON_LABELS[m] || m).join(', ') : '—'}
                </p>
              )}
            </div>
            {fld('vendor_contact_note', 'Vendor contact rule', { hint: 'e.g. “Do not contact the vendor without speaking to the contract owner.”',
              view: v => v && <strong className="text-amber-800">{v}</strong> })}
            <div className="md:col-span-2">
              {editing
                ? check('Custom MSA', 'custom_msa')
                : fld('custom_msa', 'Custom MSA', { view: v => (v ? 'Yes' : '') })}
              {form.custom_msa && (
                <p className="text-xs text-amber-700 mt-1">A copy of the MSA must be attached under Documents (type “MSA copy”) before this contract can be made Active.</p>
              )}
            </div>
          </div>
        </Section>
      )}

      <Section id="terms" title="Renewal & termination" hint="Add later">
        <div className="grid md:grid-cols-3 gap-4">
          {fld('last_renewal_date', 'Last renewal date', { type: 'date', view: v => v && fmtDate(v) })}
          {fld('renewal_type', 'Renewal type', { noBlank: true, options: Object.entries(RENEWAL_LABELS) })}
          {fld('renewal_term', 'Renewal term', { hint: 'e.g. 12 months' })}
          {fld('notice_terms', 'Renewal notice terms (as written)', { hint: 'e.g. “60 days written notice”. The number of days above drives the reminders.' })}
          {fld('termination_for_convenience', 'Termination for convenience?', { options: TRI, view: v => triLabel(v) })}
          {form.termination_for_convenience === 'true' && fld('termination_notice_days', 'Termination notice (days)', { type: 'number', min: 0 })}
          {fld('termination_date', 'Termination date', { type: 'date', hint: 'When this contract was confirmed terminated or not renewed. Leave blank until that’s decided.',
            view: v => (v ? fmtDate(v)
              : (form.expiration_date && !form.evergreen && form.expiration_date < new Date().toISOString().slice(0, 10)
                ? <span className="text-amber-700">Not yet recorded: end date has passed</span> : '')) })}
        </div>
      </Section>

      {hasTypeDetails && kind === 'mou' && (
        <Section id="type-details" title="MOU details" hint="Add later">
          <div className="grid md:grid-cols-2 gap-4">
            <DetailField {...{ editing, d, setDetail }} k="purpose" label="Purpose" area cls="md:col-span-2" />
            <DetailField {...{ editing, d, setDetail }} k="next_step" label="Expected next step" hint="e.g. definitive agreement" />
            <DetailField {...{ editing, d, setDetail }} k="target_date" label="Target date" type="date" />
            <DetailField {...{ editing, d, setDetail }} k="binding_clauses" label="Binding clauses" hint="e.g. confidentiality, exclusivity" cls="md:col-span-2" />
          </div>
        </Section>
      )}
      {hasTypeDetails && kind === 'sow' && (
        <Section id="type-details" title="SOW details" hint="Add later">
          <div className="grid md:grid-cols-2 gap-4">
            <DetailField {...{ editing, d, setDetail }} k="project_name" label="Project name" />
            <DetailField {...{ editing, d, setDetail }} k="deliverables" label="Deliverables summary" area cls="md:col-span-2" />
            {editing && <p className="text-xs text-gray-400 md:col-span-2">Add milestones (date + description) under Milestones after saving.</p>}
          </div>
        </Section>
      )}
      {hasTypeDetails && kind === 'vendor' && (
        <Section id="type-details" title="Vendor details" hint="Add later">
          <div className="grid md:grid-cols-2 gap-4">
            <DetailField {...{ editing, d, setDetail }} k="vendor_contact" label="Vendor contact" />
          </div>
        </Section>
      )}

      <Section id="related" title="Related & provisions" hint="Add later">
        <div className="grid md:grid-cols-2 gap-4">
          {fld('amends_id', 'This is an amendment to', { options: [['', 'Not an amendment'], ...contractOpts], view: v => contractOpts.find(([val]) => val === v)?.[1], hint: 'Links to the contract it amends.' })}
          {fld('superseded_by_id', 'Superseded by', { options: [['', 'Not superseded'], ...contractOpts], view: v => contractOpts.find(([val]) => val === v)?.[1] })}
          {fld('amended_date', 'Amended date', { type: 'date', view: v => v && fmtDate(v) })}
          {fld('amendment_description', 'Amendment description')}
          {fld('notes', 'Notes', { area: 3, cls: 'md:col-span-2' })}
        </div>
        <p className="text-xs font-semibold text-gray-600 mt-4 mb-2">Provisions present{editing ? ' (optional)' : ''}</p>
        {editing ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {PROVISIONS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!form.provisions[k]} onChange={e => set('provisions', { ...form.provisions, [k]: e.target.checked })} /> {label}
              </label>
            ))}
          </div>
        ) : <p className={`text-sm ${provisionNames.length ? '' : 'text-gray-300'}`}>{provisionNames.length ? provisionNames.join(' · ') : '—'}</p>}
      </Section>

      {editing && (
        <div className="flex gap-2 mb-5">
          <button className={btnPrimary} disabled={saving}>{saveLabel}</button>
          <Link className={btnSecondary} to={id ? `/contracts/${id}` : '/contracts'}>Cancel</Link>
        </div>
      )}
      {editing && !id && <p className="text-xs text-gray-400 -mt-2 mb-5">New contracts start as a draft. Documents, milestones and links can be added on the next page.</p>}
    </form>
  )

  return (
    <Page title={title} actions={actions}>
      {id && (
        <div className="flex flex-wrap items-center gap-2 mb-4 -mt-2">
          <StatusBadge status={contract.status} />
          <span className="text-sm text-gray-500">{contract.type?.name} · {contract.counterparty?.name}</span>
          {contract.sensitivity === 'restricted' && <span className="text-[11px] font-semibold text-red-700 bg-red-50 rounded px-1.5 py-0.5" title="Restricted: only the owner, backup owner, named people, admins and auditors can see this contract.">Restricted</span>}
          {contract.no_original_exception && <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 rounded px-1.5 py-0.5" title={`Admin exception: no executed original is on file. Reason: ${contract.no_original_reason}`}>Original not on file</span>}
          {contract.custom_msa && <span className="text-[11px] font-semibold text-blue-800 bg-blue-50 rounded px-1.5 py-0.5" title='This contract has a custom MSA: a signed copy must be attached (document type "MSA copy") before it can go Active.'>Custom MSA</span>}
          {contract.status === 'active' && contract.notice_deadline && days <= 60 && (
            <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${days < 0 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
              {days < 0 ? `Notice deadline passed ${-days} days ago` : `Notice deadline in ${days} days`}
            </span>
          )}
        </div>
      )}
      <ErrorMsg error={error} />
      <div className="md:flex md:gap-8 md:items-start">
        <SectionNav items={navItems} orientation="left" title={id ? form.title : undefined} />
        <div className="flex-1 min-w-0">
          {hasDecision && <DecisionPanel contract={contract} canEdit={canEdit} directory={ref.directory} profileId={profile?.id} autoOpen={new URLSearchParams(location.search).has('decide')} />}
          {form_}
          {id && (
            <>
              <DocumentsPanel contract={contract} canEdit={canEdit} directory={ref.directory} onChange={() => setVersion(v => v + 1)} />
              <MilestonesPanel contract={contract} canEdit={canEdit} onVisible={setVisible('milestones')} />
              <LinksPanel contract={contract} canEdit={canEdit} profileId={profile?.id} onVisible={setVisible('links')} />
              <AccessPanel contract={contract} canEdit={canEdit} directory={ref.directory} profileId={profile?.id} />
              <SignatoriesPanel contract={contract} canEdit={canEdit} profileId={profile?.id} onVisible={setVisible('signatories')} />
              <RelationshipsPanel contract={contract} allContracts={ref.contracts} onVisible={setVisible('relationships')} />
              {can.seeAudit && <HistoryPanel contract={contract} directory={ref.directory} />}
            </>
          )}
        </div>
      </div>
    </Page>
  )
}

// A field kept in the `details` jsonb (type-specific), same view/edit treatment as the rest.
function DetailField({ editing, d, setDetail, k, label, hint, area, type = 'text', cls = '' }) {
  const v = d[k] || ''
  if (!editing) {
    const shown = type === 'date' && v ? fmtDate(v) : v
    return (
      <div className={`min-w-0 ${cls}`}>
        <dt className="block text-xs font-semibold text-gray-600 mb-1">{label}</dt>
        <dd className={`text-sm py-1.5 break-words whitespace-pre-wrap ${shown ? 'text-gray-900' : 'text-gray-300'}`}>{shown || '—'}</dd>
      </div>
    )
  }
  return (
    <Field label={label} hint={hint} className={cls}>
      {area
        ? <textarea className={inputCls} rows={2} value={v} onChange={e => setDetail(k, e.target.value)} />
        : <input className={inputCls} type={type} value={v} onChange={e => setDetail(k, e.target.value)} />}
    </Field>
  )
}
