import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { listContracts, listTypes, getDirectory } from '../lib/contracts'
import { fmtDate, STATUS_LABELS } from '../lib/format'
import { Page, StatusBadge, ErrorMsg, Loading, btnPrimary, inputCls } from '../components/ui'
import { useCan } from '../context/AuthContext'

// Filter/sort by type, status, counterparty, owner, department, tag, text (R-S1/R-S2 metadata).
export default function Contracts() {
  const can = useCan()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState({ loading: true })
  const [sort, setSort] = useState({ key: 'title', dir: 1 })

  useEffect(() => {
    Promise.all([listContracts(), listTypes({ includeInactive: true }), getDirectory()])
      .then(([contracts, types, directory]) => setState({ loading: false, contracts, types, directory }))
      .catch(error => setState({ loading: false, error }))
  }, [])

  const f = { q: params.get('q') || '', status: params.get('status') || '', type: params.get('type') || '', owner: params.get('owner') || '', dept: params.get('dept') || '' }
  const set = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p, { replace: true }) }

  const ownerName = id => state.directory?.find(p => p.id === id)?.display_name || ''
  const departments = useMemo(() => [...new Set((state.contracts || []).map(c => c.department))].sort(), [state.contracts])

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    const out = (state.contracts || []).filter(c =>
      (!f.status || c.status === f.status) && (!f.type || c.type_id === f.type) &&
      (!f.owner || c.owner_id === f.owner) && (!f.dept || c.department === f.dept) &&
      (!q || [c.title, c.counterparty?.name, c.notes, c.department, ...(c.tags || [])].some(v => v?.toLowerCase().includes(q))))
    const val = c => ({ title: c.title, counterparty: c.counterparty?.name, type: c.type?.name, status: c.status, owner: ownerName(c.owner_id),
      notice: c.notice_deadline || '9999', expires: c.expiration_date || '9999' }[sort.key] ?? '')
    return out.sort((a, b) => String(val(a)).localeCompare(String(val(b))) * sort.dir)
  }, [state, f.q, f.status, f.type, f.owner, f.dept, sort])

  const Th = ({ k, children }) => (
    <th className="text-left px-3 py-2 font-semibold cursor-pointer select-none" onClick={() => setSort(s => ({ key: k, dir: s.key === k ? -s.dir : 1 }))}>
      {children}{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  )

  return (
    <Page wide title="Contracts" actions={can.add && <Link to="/contracts/new" className={btnPrimary}><Plus size={15} /> New contract</Link>}>
      <ErrorMsg error={state.error} />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        <input className={`${inputCls} col-span-2 md:col-span-1`} placeholder="Search title, counterparty, tag…" value={f.q} onChange={e => set('q', e.target.value)} />
        <select className={inputCls} value={f.type} onChange={e => set('type', e.target.value)}>
          <option value="">All types</option>{state.types?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className={inputCls} value={f.status} onChange={e => set('status', e.target.value)}>
          <option value="">All statuses</option>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={inputCls} value={f.owner} onChange={e => set('owner', e.target.value)}>
          <option value="">All owners</option>{state.directory?.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
        <select className={inputCls} value={f.dept} onChange={e => set('dept', e.target.value)}>
          <option value="">All departments</option>{departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {state.loading ? <Loading /> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600"><tr>
              <Th k="title">Title</Th><Th k="counterparty">Counterparty</Th><Th k="type">Type</Th><Th k="status">Status</Th>
              <Th k="owner">Owner</Th><Th k="notice">Notice deadline</Th><Th k="expires">Expires</Th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2"><Link to={`/contracts/${c.id}`} className="font-medium text-brand hover:underline">{c.title}</Link>
                    {c.sensitivity === 'restricted' && <span className="ml-2 text-[11px] font-semibold text-red-700 bg-red-50 rounded px-1.5 py-0.5">Restricted</span>}</td>
                  <td className="px-3 py-2">{c.counterparty?.name}</td>
                  <td className="px-3 py-2">{c.type?.name}</td>
                  <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                  <td className="px-3 py-2">{ownerName(c.owner_id)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{c.evergreen ? 'Evergreen' : fmtDate(c.notice_deadline)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{c.evergreen ? '—' : fmtDate(c.expiration_date)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No contracts match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-2">{rows.length} contract{rows.length === 1 ? '' : 's'}</p>
    </Page>
  )
}
