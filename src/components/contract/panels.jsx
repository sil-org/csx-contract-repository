import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Upload, Trash2, ExternalLink } from 'lucide-react'
import { Card, Field, ErrorMsg, btnPrimary, btnSecondary, inputCls } from '../ui'
import { fmtDate, fmtDateTime, fmtBytes, daysUntil, DOC_ROLE_LABELS, DECISION_LABELS } from '../../lib/format'
import {
  listLinks, addLink, deleteLink, listMilestones, addMilestone, setMilestoneDone, deleteMilestone,
  listDecisions, recordDecision, listAccess, grantAccess, revokeAccess, listAudit, listRelated,
  listSignatories, addSignatory, deleteSignatory,
} from '../../lib/contracts'
import { listDocuments, uploadDocument, openDocument, ALLOWED_TYPES } from '../../lib/documents'

const nameOf = (directory, id) => directory.find(p => p.id === id)?.display_name || 'Unknown'

// Small loader hook: runs `fn` now and whenever `reload()` is called.
function useLoad(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const run = useCallback(() => fn().then(data => setState({ loading: false, data, error: null }))
    .catch(error => setState({ loading: false, data: null, error })), deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run() }, [run])
  return [state, run]
}

// ── Documents ────────────────────────────────────────────────────────────────
export function DocumentsPanel({ contract, canEdit, directory, onChange }) {
  const [{ data: docs, error }, reload] = useLoad(() => listDocuments(contract.id), [contract.id])
  const [form, setForm] = useState({ role: 'original', note: '', file: null, docKey: '' })
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  // Group versions of the same logical document; newest first.
  const groups = Object.values((docs || []).reduce((acc, d) => { (acc[d.doc_key] ||= []).push(d); return acc }, {}))
    .map(g => g.sort((a, b) => b.version - a.version))
  const hasOriginal = (docs || []).some(d => d.role === 'original')
  const hasMsa = (docs || []).some(d => d.role === 'msa')

  async function submit(e) {
    e.preventDefault(); setErr(null)
    try {
      await uploadDocument({ contractId: contract.id, file: form.file, role: form.role, changeNote: form.note, docKey: form.docKey || null, onStatus: setBusy })
      setForm({ role: form.docKey ? form.role : 'original', note: '', file: null, docKey: '' })
      e.target.reset(); reload(); onChange?.()
    } catch (x) { setErr(x) } finally { setBusy(null) }
  }
  async function open(id) { try { await openDocument(id) } catch (x) { setErr(x) } }

  return (
    <Card title="Documents" id="documents">
      <ErrorMsg error={error || err} />
      {!hasOriginal && docs && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2 mb-3">
          {contract.no_original_exception
            ? <>No executed original on file. An admin recorded an exception: <em>{contract.no_original_reason}</em></>
            : <>No executed original on file yet. A contract can't be set to Active until a PDF is uploaded as <strong>Original (executed)</strong>, or an admin records a "not on file" exception.</>}
        </div>
      )}
      {contract.custom_msa && !hasMsa && docs && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2 mb-3">
          This contract has a custom MSA, but no copy is on file. A contract can't be set to Active until one is uploaded as <strong>MSA copy</strong>.
        </div>
      )}
      <ul className="divide-y divide-gray-100 mb-4">
        {groups.map(g => (
          <li key={g[0].doc_key} className="py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-xs font-semibold bg-gray-100 text-gray-700 rounded px-2 py-0.5">{DOC_ROLE_LABELS[g[0].role]}</span>
              <span className="font-medium text-sm">{g[0].filename}</span>
              <span className="text-xs text-gray-400">v{g[0].version} · {fmtBytes(g[0].size_bytes)}</span>
              <button className="ml-auto text-brand text-sm inline-flex items-center gap-1 hover:underline" onClick={() => open(g[0].id)}><ExternalLink size={14} /> Open</button>
            </div>
            <ul className="mt-1.5 ml-2 space-y-0.5">
              {g.map(d => (
                <li key={d.id} className="text-xs text-gray-500 flex flex-wrap gap-x-3">
                  <span className="font-semibold">v{d.version}</span>
                  <span>{fmtDateTime(d.uploaded_at)} · {nameOf(directory, d.uploaded_by)}</span>
                  <span className="italic">“{d.change_note}”</span>
                  <span className="font-mono text-gray-400" title={`SHA-256 ${d.sha256}`}>sha256 {d.sha256.slice(0, 10)}…</span>
                  {d.version !== g[0].version && <button className="text-brand hover:underline" onClick={() => open(d.id)}>open</button>}
                </li>
              ))}
            </ul>
          </li>
        ))}
        {docs && !groups.length && <li className="py-3 text-sm text-gray-400">No documents yet.</li>}
      </ul>

      {canEdit && (
        <form onSubmit={submit} className="border-t border-gray-100 pt-4 grid md:grid-cols-2 gap-3">
          <p className="md:col-span-2 text-xs text-gray-500">Files are stored unaltered and can't be overwritten or deleted. To correct a document, upload a new version — earlier versions are kept.</p>
          <Field label="Document type">
            <select className={inputCls} value={form.role} disabled={!!form.docKey} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {Object.entries(DOC_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="New version of…" hint="Leave blank to add a new document.">
            <select className={inputCls} value={form.docKey} onChange={e => {
              const g = groups.find(x => x[0].doc_key === e.target.value)
              setForm(f => ({ ...f, docKey: e.target.value, role: g ? g[0].role : f.role }))
            }}>
              <option value="">— a new document —</option>
              {groups.map(g => <option key={g[0].doc_key} value={g[0].doc_key}>{g[0].filename} (v{g[0].version})</option>)}
            </select>
          </Field>
          <Field label="File" required hint={`${Object.values(ALLOWED_TYPES).join(', ')} · up to 50 MB · executed originals must be PDF`}>
            <input type="file" required className="text-sm" accept={Object.keys(ALLOWED_TYPES).join(',')} onChange={e => setForm(f => ({ ...f, file: e.target.files[0] || null }))} />
          </Field>
          <Field label="Change note" required hint="What is this file / what changed?">
            <input className={inputCls} required value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          </Field>
          <div className="md:col-span-2">
            <button className={btnPrimary} disabled={!!busy || !form.file}><Upload size={15} /> {busy || 'Upload'}</button>
          </div>
        </form>
      )}
    </Card>
  )
}

// ── Decision (R-R5) ──────────────────────────────────────────────────────────
export function DecisionPanel({ contract, canEdit, directory, profileId, autoOpen }) {
  const [{ data: decisions, error }, reload] = useLoad(() => listDecisions([contract.id]), [contract.id, contract.notice_deadline])
  const [form, setForm] = useState({ decision: 'renew', rationale: '' })
  const [err, setErr] = useState(null)
  if (contract.status !== 'active' || !contract.notice_deadline) return null

  const current = decisions?.find(d => d.notice_deadline === contract.notice_deadline)
  const days = daysUntil(contract.notice_deadline)

  async function submit(e) {
    e.preventDefault(); setErr(null)
    try { await recordDecision({ contractId: contract.id, noticeDeadline: contract.notice_deadline, ...form, profileId }); reload() } catch (x) { setErr(x) }
  }

  return (
    <Card title="Renewal decision" id="decision">
      <ErrorMsg error={error || err} />
      <p className="text-sm text-gray-600 mb-3">
        Notice deadline <strong>{fmtDate(contract.notice_deadline)}</strong>{' '}
        <span className={days < 0 ? 'text-red-700 font-semibold' : 'text-gray-400'}>({days < 0 ? `${-days} days ago` : `in ${days} days`})</span>
      </p>
      {current ? (
        <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
          <strong>{DECISION_LABELS[current.decision]}</strong> — recorded by {nameOf(directory, current.decided_by)} on {fmtDateTime(current.decided_at)}.
          {current.rationale && <div className="text-gray-600 mt-1">“{current.rationale}”</div>}
          <div className="text-xs text-gray-500 mt-1">Reminders and escalation for this cycle are stopped. When the dates are updated after a renewal, a new cycle begins.</div>
        </div>
      ) : canEdit ? (
        <form onSubmit={submit} className={`grid md:grid-cols-3 gap-3 ${autoOpen ? 'ring-2 ring-brand/40 rounded-lg p-3' : ''}`}>
          <Field label="Decision"><select className={inputCls} value={form.decision} onChange={e => setForm(f => ({ ...f, decision: e.target.value }))}>
            {Object.entries(DECISION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Rationale" className="md:col-span-2"><input className={inputCls} value={form.rationale} onChange={e => setForm(f => ({ ...f, rationale: e.target.value }))} /></Field>
          <div className="md:col-span-3"><button className={btnPrimary}>Record decision</button></div>
        </form>
      ) : <p className="text-sm text-amber-700">No decision recorded yet.</p>}
    </Card>
  )
}

// ── Milestones ───────────────────────────────────────────────────────────────
export function MilestonesPanel({ contract, canEdit, onVisible }) {
  const [{ data: items, error }, reload] = useLoad(() => listMilestones(contract.id), [contract.id])
  const [form, setForm] = useState({ due: '', desc: '' })
  const [err, setErr] = useState(null)
  const act = fn => async (...a) => { setErr(null); try { await fn(...a); reload() } catch (x) { setErr(x) } }

  const visible = canEdit || !!items?.length
  useEffect(() => { onVisible?.(visible) }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!visible) return null
  return (
    <Card title="Milestones and dated obligations" id="milestones">
      <ErrorMsg error={error || err} />
      <ul className="divide-y divide-gray-100 mb-2">
        {items?.map(m => (
          <li key={m.id} className="py-2 flex items-center gap-3 text-sm">
            <input type="checkbox" disabled={!canEdit} checked={!!m.completed_at} onChange={e => act(setMilestoneDone)(m.id, e.target.checked)} aria-label="Completed" />
            <span className="font-medium w-28">{fmtDate(m.due_on)}</span>
            <span className={m.completed_at ? 'line-through text-gray-400' : ''}>{m.description}</span>
            {canEdit && <button className="ml-auto text-gray-400 hover:text-red-600" onClick={act(deleteMilestone).bind(null, m.id)} aria-label="Delete milestone"><Trash2 size={14} /></button>}
          </li>
        ))}
        {items && !items.length && <li className="py-2 text-sm text-gray-400">None.</li>}
      </ul>
      {canEdit && (
        <form className="flex flex-wrap gap-2 items-end" onSubmit={async e => { e.preventDefault(); await act(addMilestone)(contract.id, form.due, form.desc); setForm({ due: '', desc: '' }) }}>
          <Field label="Due date"><input type="date" required className={inputCls} value={form.due} onChange={e => setForm(f => ({ ...f, due: e.target.value }))} /></Field>
          <Field label="Description" className="flex-1 min-w-[12rem]"><input required className={inputCls} value={form.desc} onChange={e => setForm(f => ({ ...f, desc: e.target.value }))} /></Field>
          <button className={btnSecondary}>Add</button>
        </form>
      )}
    </Card>
  )
}

// ── External links (working copies) ──────────────────────────────────────────
export function LinksPanel({ contract, canEdit, profileId, onVisible }) {
  const [{ data: links, error }, reload] = useLoad(() => listLinks(contract.id), [contract.id])
  const [form, setForm] = useState({ url: '', label: 'Working copy' })
  const [err, setErr] = useState(null)
  const visible = canEdit || !!links?.length
  useEffect(() => { onVisible?.(visible) }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!visible) return null
  return (
    <Card title="Working-copy links" id="links">
      <ErrorMsg error={error || err} />
      <p className="text-xs text-gray-500 mb-2">Convenience links (e.g. Google Drive). They can break if someone moves or deletes the file — the stored original above is the authoritative copy.</p>
      <ul className="divide-y divide-gray-100 mb-2">
        {links?.map(l => (
          <li key={l.id} className="py-2 flex items-center gap-3 text-sm">
            <a className="text-brand hover:underline inline-flex items-center gap-1" href={l.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> {l.label}</a>
            <span className="text-gray-400 truncate">{l.url}</span>
            {canEdit && <button className="ml-auto text-gray-400 hover:text-red-600" aria-label="Remove link" onClick={async () => { try { await deleteLink(l.id); reload() } catch (x) { setErr(x) } }}><Trash2 size={14} /></button>}
          </li>
        ))}
        {links && !links.length && <li className="py-2 text-sm text-gray-400">None.</li>}
      </ul>
      {canEdit && (
        <form className="flex flex-wrap gap-2 items-end" onSubmit={async e => {
          e.preventDefault(); setErr(null)
          try { await addLink(contract.id, form.url, form.label, profileId); setForm({ url: '', label: 'Working copy' }); reload() } catch (x) { setErr(x) }
        }}>
          <Field label="URL" className="flex-1 min-w-[14rem]"><input type="url" required className={inputCls} placeholder="https://drive.google.com/…" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} /></Field>
          <Field label="Label"><input className={inputCls} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} /></Field>
          <button className={btnSecondary}>Add link</button>
        </form>
      )}
    </Card>
  )
}

// ── Named access for restricted contracts (R-U3) ─────────────────────────────
export function AccessPanel({ contract, canEdit, directory, profileId }) {
  const [{ data: rows, error }, reload] = useLoad(() => listAccess(contract.id), [contract.id])
  const [pick, setPick] = useState('')
  const [err, setErr] = useState(null)
  if (contract.sensitivity !== 'restricted') return null
  const act = fn => async () => { setErr(null); try { await fn(); reload() } catch (x) { setErr(x) } }
  return (
    <Card title="Who can see this restricted contract" id="access">
      <ErrorMsg error={error || err} />
      <p className="text-xs text-gray-500 mb-2">Always: the owner, backup owner, admins and auditors. Plus the people named here.</p>
      <ul className="mb-2 text-sm">
        {rows?.map(r => (
          <li key={r.profile_id} className="py-1 flex items-center gap-3">{nameOf(directory, r.profile_id)}
            {canEdit && <button className="text-gray-400 hover:text-red-600" aria-label="Remove access" onClick={act(() => revokeAccess(contract.id, r.profile_id))}><Trash2 size={14} /></button>}</li>
        ))}
        {rows && !rows.length && <li className="text-gray-400">No one else.</li>}
      </ul>
      {canEdit && (
        <div className="flex gap-2">
          <select className={inputCls} value={pick} onChange={e => setPick(e.target.value)}><option value="">Add a person…</option>
            {directory.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select>
          <button className={btnSecondary} disabled={!pick} onClick={act(async () => { await grantAccess(contract.id, pick, profileId); setPick('') })}>Add</button>
        </div>
      )}
    </Card>
  )
}

// ── Signatory history ─────────────────────────────────────────────────────────
// contracts.signatory_name/signatory_email are a synced cache of whichever row here has the
// latest start_date on or before today (09_responsible_party_history.sql) -- add a dated entry
// here to change the signatory, rather than treating the current fields as directly editable.
export function SignatoriesPanel({ contract, canEdit, profileId, onVisible }) {
  const [{ data: items, error }, reload] = useLoad(() => listSignatories(contract.id), [contract.id])
  const [form, setForm] = useState({ name: '', email: '', start_date: '', note: '' })
  const [err, setErr] = useState(null)
  const act = fn => async (...a) => { setErr(null); try { await fn(...a); reload() } catch (x) { setErr(x) } }
  const visible = canEdit || !!items?.length
  useEffect(() => { onVisible?.(visible) }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!visible) return null

  const today = new Date().toISOString().slice(0, 10)
  const currentId = items?.filter(s => s.start_date <= today).sort((a, b) => b.start_date.localeCompare(a.start_date) || b.created_at.localeCompare(a.created_at))[0]?.id

  return (
    <Card title="Signatory history" id="signatories">
      <ErrorMsg error={error || err} />
      <p className="text-xs text-gray-500 mb-2">Who's responsible for signing can change over a long-running contract. The most recent entry on or before today is the current signatory shown elsewhere on this record.</p>
      <ul className="divide-y divide-gray-100 mb-2">
        {items?.map(s => (
          <li key={s.id} className="py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{s.name}</span>
              {s.id === currentId && <span className="text-[11px] font-semibold text-green-800 bg-green-50 rounded px-1.5 py-0.5">Current</span>}
              <span className="text-gray-400 ml-auto">{fmtDate(s.start_date)}</span>
              {canEdit && <button className="text-gray-400 hover:text-red-600" aria-label="Remove entry" onClick={act(deleteSignatory).bind(null, s.id)}><Trash2 size={14} /></button>}
            </div>
            {s.email && <div className="text-xs text-gray-500">{s.email}</div>}
            {s.note && <div className="text-xs text-gray-500 italic">“{s.note}”</div>}
          </li>
        ))}
        {items && !items.length && <li className="py-2 text-sm text-gray-400">None yet.</li>}
      </ul>
      {canEdit && (
        <form className="grid md:grid-cols-2 gap-3" onSubmit={async e => {
          e.preventDefault()
          await act(addSignatory)(contract.id, form, profileId)
          setForm({ name: '', email: '', start_date: '', note: '' })
        }}>
          <Field label="Name" required><input className={inputCls} required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Email"><input type="email" className={inputCls} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></Field>
          <Field label="Effective from" required hint="The date this person became (or becomes) the signatory.">
            <input type="date" required className={inputCls} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
          </Field>
          <Field label="Note" hint="e.g. “New hire, replacing Jo after the 2027 renewal.”"><input className={inputCls} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></Field>
          <div className="md:col-span-2"><button className={btnSecondary}>Add entry</button></div>
        </form>
      )}
    </Card>
  )
}

// ── Relationships ────────────────────────────────────────────────────────────
export function RelationshipsPanel({ contract, allContracts, onVisible }) {
  const [{ data: related }] = useLoad(() => listRelated(contract.id), [contract.id])
  const byId = id => allContracts.find(c => c.id === id)
  const amends = contract.amends_id && byId(contract.amends_id)
  const supers = contract.superseded_by_id && byId(contract.superseded_by_id)
  const amendments = (related || []).filter(r => r.amends_id === contract.id)
  const visible = !!(amends || supers || amendments.length)
  useEffect(() => { onVisible?.(visible) }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!visible) return null
  const L = c => <Link className="text-brand hover:underline" to={`/contracts/${c.id}`}>{c.title}</Link>
  return (
    <Card title="Related contracts" id="relationships">
      <ul className="text-sm space-y-1">
        {amends && <li>Amends: {L(amends)}</li>}
        {supers && <li>Superseded by: {L(supers)}</li>}
        {amendments.length > 0 && <li>Amendments: {amendments.map((c, i) => <span key={c.id}>{i > 0 && ', '}{L(c)}</span>)}</li>}
      </ul>
    </Card>
  )
}

// ── History (admins and auditors) ────────────────────────────────────────────
export function HistoryPanel({ contract, directory }) {
  const [{ data: rows, error }] = useLoad(() => listAudit({ contractId: contract.id, limit: 100 }), [contract.id])
  return (
    <Card title="History" id="history">
      <ErrorMsg error={error} />
      <ul className="divide-y divide-gray-100 text-xs">
        {rows?.map(r => (
          <li key={r.id} className="py-1.5">
            <span className="text-gray-400">{fmtDateTime(r.at)}</span> · <strong>{r.profile_id ? nameOf(directory, r.profile_id) : 'System'}</strong> · {r.action} {r.entity.replace('contract_', '')}
            {r.new_values && <span className="text-gray-500"> {Object.keys(r.new_values).slice(0, 6).map(k => `${k}: ${JSON.stringify(r.old_values?.[k] ?? null)} → ${JSON.stringify(r.new_values[k])}`).join('; ').slice(0, 220)}</span>}
          </li>
        ))}
        {rows && !rows.length && <li className="py-2 text-gray-400">No history yet.</li>}
      </ul>
    </Card>
  )
}
