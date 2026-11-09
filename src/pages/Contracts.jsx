import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { listContracts, listTypes, listCounterparties, getDirectory } from '../lib/contracts'
import { fmtDate, fmtMoney, STATUS_LABELS } from '../lib/format'
import { Page, Card, StatusBadge, ErrorMsg, Loading, ConfidentialNote, btnPrimary, btnSecondary, inputCls } from '../components/ui'
import { useCan } from '../context/AuthContext'

const NUMERIC_SORT_KEYS = new Set(['value'])
// Filter params that aren't the default sort/page chrome — used to show/clear "filters active".
const FILTER_KEYS = ['q', 'status', 'type', 'owner', 'dept', 'vendor', 'valueMin', 'valueMax', 'signedFrom', 'signedTo', 'renewFrom', 'renewTo']

// Filter/sort by type, status, counterparty, owner, department, tag, text, value, and date ranges (R-S1/R-S2 metadata).
export default function Contracts() {
  const can = useCan()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState({ loading: true })
  const [sort, setSort] = useState({ key: 'title', dir: 1 })

  useEffect(() => {
    Promise.all([listContracts(), listTypes({ includeInactive: true }), listCounterparties(), getDirectory()])
      .then(([contracts, types, counterparties, directory]) => setState({ loading: false, contracts, types, counterparties, directory }))
      .catch(error => setState({ loading: false, error }))
  }, [])

  const f = Object.fromEntries(FILTER_KEYS.map(k => [k, params.get(k) || '']))
  const set = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p, { replace: true }) }
  const clearFilters = () => { const p = new URLSearchParams(params); FILTER_KEYS.forEach(k => p.delete(k)); setParams(p, { replace: true }) }
  const filtersActive = FILTER_KEYS.some(k => f[k])

  const ownerName = id => state.directory?.find(p => p.id === id)?.display_name || ''
  const departments = useMemo(() => [...new Set((state.contracts || []).map(c => c.department))].sort(), [state.contracts])

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    const out = (state.contracts || []).filter(c =>
      (!f.status || c.status === f.status) && (!f.type || c.type_id === f.type) &&
      (!f.owner || c.owner_id === f.owner) && (!f.dept || c.department === f.dept) &&
      (!f.vendor || c.counterparty_id === f.vendor) &&
      (!f.valueMin || (c.value_amount != null && c.value_amount >= Number(f.valueMin))) &&
      (!f.valueMax || (c.value_amount != null && c.value_amount <= Number(f.valueMax))) &&
      (!f.signedFrom || (c.signed_date && c.signed_date >= f.signedFrom)) &&
      (!f.signedTo || (c.signed_date && c.signed_date <= f.signedTo)) &&
      (!f.renewFrom || (c.last_renewal_date && c.last_renewal_date >= f.renewFrom)) &&
      (!f.renewTo || (c.last_renewal_date && c.last_renewal_date <= f.renewTo)) &&
      (!q || [c.title, c.system_name, c.counterparty?.name, c.notes, c.department, c.department_manager, c.administrators, c.signatory_name, ...(c.tags || [])].some(v => v?.toLowerCase().includes(q))))
    if (NUMERIC_SORT_KEYS.has(sort.key)) {
      const num = c => ({ value: c.value_amount }[sort.key])
      return out.sort((a, b) => {
        const av = num(a), bv = num(b)
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return (av - bv) * sort.dir
      })
    }
    const val = c => ({ title: c.title, counterparty: c.counterparty?.name, type: c.type?.name, status: c.status, owner: ownerName(c.owner_id),
      signed: c.signed_date || '9999', renewed: c.last_renewal_date || '9999',
      notice: c.notice_deadline || '9999', expires: c.expiration_date || '9999' }[sort.key] ?? '')
    return out.sort((a, b) => String(val(a)).localeCompare(String(val(b))) * sort.dir)
  }, [state, f.q, f.status, f.type, f.owner, f.dept, f.vendor, f.valueMin, f.valueMax, f.signedFrom, f.signedTo, f.renewFrom, f.renewTo, sort])

  // Summary of contract values for whatever is currently filtered in (R-S5 spend-by-vendor, lightweight version).
  // Grouped by currency rather than summed blindly — mixing currencies in one total would misrepresent spend.
  const summary = useMemo(() => {
    const sumByCurrency = field => {
      const map = {}
      let n = 0
      for (const c of rows) {
        if (c[field] == null) continue
        n++
        const cur = c.currency || 'USD'
        map[cur] = (map[cur] || 0) + Number(c[field])
      }
      return { map, n }
    }
    return { count: rows.length, value: sumByCurrency('value_amount'), annual: sumByCurrency('annual_amount') }
  }, [rows])

  const fmtCurrencySum = map => {
    const entries = Object.entries(map)
    if (!entries.length) return '—'
    return entries.map(([cur, amt]) => fmtMoney(amt, cur)).join(' + ')
  }
  const fmtAverage = ({ map, n }) => {
    const currencies = Object.keys(map)
    if (!n || !currencies.length) return '—'
    if (currencies.length > 1) return 'Mixed currencies'
    return fmtMoney(map[currencies[0]] / n, currencies[0])
  }

  const Th = ({ k, children }) => (
    <th className="text-left px-3 py-2 font-semibold cursor-pointer select-none" onClick={() => setSort(s => ({ key: k, dir: s.key === k ? -s.dir : 1 }))}>
      {children}{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  )

  return (
    <Page wide title="Contracts" actions={can.add && <Link to="/contracts/new" className={btnPrimary}><Plus size={15} /> New contract</Link>}>
      <ErrorMsg error={state.error} />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2">
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 items-end">
        <label className="block text-xs">
          <span className="block text-gray-500 mb-1">Vendor</span>
          <select className={inputCls} value={f.vendor} onChange={e => set('vendor', e.target.value)}>
            <option value="">All vendors</option>{state.counterparties?.map(cp => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
          </select>
        </label>
        <label className="block text-xs">
          <span className="block text-gray-500 mb-1">Value min</span>
          <input type="number" min="0" className={inputCls} value={f.valueMin} onChange={e => set('valueMin', e.target.value)} />
        </label>
        <label className="block text-xs">
          <span className="block text-gray-500 mb-1">Value max</span>
          <input type="number" min="0" className={inputCls} value={f.valueMax} onChange={e => set('valueMax', e.target.value)} />
        </label>
        <button type="button" className={btnSecondary} onClick={clearFilters} disabled={!filtersActive}>Clear filters</button>
        <label className="block text-xs">
          <span className="block text-gray-500 mb-1">Signed after</span>
          <input type="date" className={inputCls} value={f.signedFrom} onChange={e => set('signedFrom', e.target.value)} />
        </label>
        <label className="block text-xs">
          <span className="block text-gray-500 mb-1">Signed before</span>
          <input type="date" className={inputCls} value={f.signedTo} onChange={e => set('signedTo', e.target.value)} />
        </label>
        <label className="block text-xs">
          <span className="block text-gray-500 mb-1">Last renewed after</span>
          <input type="date" className={inputCls} value={f.renewFrom} onChange={e => set('renewFrom', e.target.value)} />
        </label>
        <label className="block text-xs">
          <span className="block text-gray-500 mb-1">Last renewed before</span>
          <input type="date" className={inputCls} value={f.renewTo} onChange={e => set('renewTo', e.target.value)} />
        </label>
      </div>

      <Card title="Summary of contract values (filtered)">
        <ConfidentialNote />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><div className="text-xs font-medium text-gray-500">Contracts</div><div className="text-lg font-bold text-gray-800">{summary.count}</div></div>
          <div><div className="text-xs font-medium text-gray-500">Total contract value</div><div className="text-lg font-bold text-gray-800">{fmtCurrencySum(summary.value.map)}</div>
            <div className="text-xs text-gray-400">{summary.value.n} with a value recorded</div></div>
          <div><div className="text-xs font-medium text-gray-500">Total annual amount</div><div className="text-lg font-bold text-gray-800">{fmtCurrencySum(summary.annual.map)}</div>
            <div className="text-xs text-gray-400">{summary.annual.n} with an annual amount recorded</div></div>
          <div><div className="text-xs font-medium text-gray-500">Avg. contract value</div><div className="text-lg font-bold text-gray-800">{fmtAverage(summary.value)}</div></div>
        </div>
      </Card>

      {state.loading ? <Loading /> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600"><tr>
              <Th k="title">Title</Th><Th k="counterparty">Counterparty</Th><Th k="type">Type</Th><Th k="status">Status</Th>
              <Th k="owner">Owner</Th><Th k="value">Value</Th><Th k="signed">Signed</Th><Th k="renewed">Last renewal</Th>
              <Th k="notice">Notice deadline</Th><Th k="expires">Expires</Th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2"><Link to={`/contracts/${c.id}`} className="font-medium text-brand hover:underline">{c.title}</Link>
                    {c.system_name && c.system_name !== c.title && <div className="text-xs text-gray-400">{c.system_name}</div>}
                    {c.sensitivity === 'restricted' && <span className="ml-2 text-[11px] font-semibold text-red-700 bg-red-50 rounded px-1.5 py-0.5" title="Restricted: only the owner, backup owner, named people, admins and auditors can see this contract.">Restricted</span>}
                    {c.no_original_exception && <span className="ml-2 text-[11px] font-semibold text-amber-800 bg-amber-100 rounded px-1.5 py-0.5" title={`Admin exception: no executed original is on file. Reason: ${c.no_original_reason}`}>No original</span>}
                    {c.custom_msa && <span className="ml-2 text-[11px] font-semibold text-blue-800 bg-blue-50 rounded px-1.5 py-0.5" title='This contract has a custom MSA: a signed copy must be attached (document type "MSA copy") before it can go Active.'>Custom MSA</span>}</td>
                  <td className="px-3 py-2">{c.counterparty?.name}</td>
                  <td className="px-3 py-2">{c.type?.name}</td>
                  <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                  <td className="px-3 py-2">{ownerName(c.owner_id)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtMoney(c.value_amount, c.currency)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(c.signed_date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(c.last_renewal_date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{c.evergreen ? 'Evergreen' : fmtDate(c.notice_deadline)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{c.evergreen ? '—' : fmtDate(c.expiration_date)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">No contracts match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-2">{rows.length} contract{rows.length === 1 ? '' : 's'}</p>
    </Page>
  )
}
