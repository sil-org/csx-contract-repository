import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { listContracts, listTypes, listCounterparties, getDirectory } from '../lib/contracts'
import { fmtDate, fmtMoney, STATUS_LABELS, typeAbbrev } from '../lib/format'
import { Page, Card, StatusBadge, ErrorMsg, Loading, ConfidentialNote, btnPrimary, inputCls } from '../components/ui'
import MultiSelect from '../components/MultiSelect'
import { useCan } from '../context/AuthContext'

const NUMERIC_SORT_KEYS = new Set(['value'])
// Scalar (single-value) vs. multi-select filter params — kept separate because multi-select
// values are read/written as repeated query params (?status=active&status=draft), not one string.
const SCALAR_FILTER_KEYS = ['q', 'valueMin', 'valueMax', 'signedFrom', 'signedTo', 'renewFrom', 'renewTo']
const MULTI_FILTER_KEYS = ['status', 'type', 'owner', 'dept', 'vendor']
const FILTER_KEYS = [...SCALAR_FILTER_KEYS, ...MULTI_FILTER_KEYS]
// New contracts are overwhelmingly what people want to see day-to-day; everything else (expired,
// terminated, etc.) is opt-in. Only applies until the status filter is touched (see `f.status` below).
const DEFAULT_STATUSES = ['active', 'draft']
// Marks "status" as explicitly cleared to nothing (distinct from untouched, which defaults above).
const ALL_SENTINEL = '__all__'
const FILTERS_COLLAPSE_KEY = 'contracts.filtersCollapsed'

// Filter/sort by type, status, vendor, owner, department, tag, text, value, and date ranges (R-S1/R-S2 metadata).
export default function Contracts() {
  const can = useCan()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState({ loading: true })
  const [sort, setSort] = useState({ key: 'title', dir: 1 })
  const [filtersCollapsed, setFiltersCollapsed] = useState(() => {
    try { return localStorage.getItem(FILTERS_COLLAPSE_KEY) === '1' } catch { return false }
  })
  const toggleFiltersCollapsed = () => setFiltersCollapsed(c => {
    try { localStorage.setItem(FILTERS_COLLAPSE_KEY, c ? '0' : '1') } catch {}
    return !c
  })

  useEffect(() => {
    Promise.all([listContracts(), listTypes({ includeInactive: true }), listCounterparties(), getDirectory()])
      .then(([contracts, types, counterparties, directory]) => setState({ loading: false, contracts, types, counterparties, directory }))
      .catch(error => setState({ loading: false, error }))
  }, [])

  const f = {
    ...Object.fromEntries(SCALAR_FILTER_KEYS.map(k => [k, params.get(k) || ''])),
    ...Object.fromEntries(['type', 'owner', 'dept', 'vendor'].map(k => [k, params.getAll(k)])),
    status: (() => {
      const raw = params.getAll('status')
      if (!raw.length) return DEFAULT_STATUSES
      if (raw.length === 1 && raw[0] === ALL_SENTINEL) return []
      return raw
    })(),
  }
  const set = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p, { replace: true }) }
  const setMulti = (k, arr) => {
    const p = new URLSearchParams(params)
    p.delete(k)
    if (k === 'status' && arr.length === 0) p.append(k, ALL_SENTINEL)
    else arr.forEach(v => p.append(k, v))
    setParams(p, { replace: true })
  }
  const clearFilters = () => { const p = new URLSearchParams(params); FILTER_KEYS.forEach(k => p.delete(k)); setParams(p, { replace: true }) }
  const filtersActive = SCALAR_FILTER_KEYS.some(k => f[k]) || ['type', 'owner', 'dept', 'vendor'].some(k => f[k].length) || params.has('status')

  const ownerName = id => state.directory?.find(p => p.id === id)?.display_name || ''
  const departments = useMemo(() => [...new Set((state.contracts || []).map(c => c.department))].sort(), [state.contracts])

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    const out = (state.contracts || []).filter(c =>
      (!f.status.length || f.status.includes(c.status)) && (!f.type.length || f.type.includes(c.type_id)) &&
      (!f.owner.length || f.owner.includes(c.owner_id)) && (!f.dept.length || f.dept.includes(c.department)) &&
      (!f.vendor.length || f.vendor.includes(c.counterparty_id)) &&
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
    // Multi-select filters (f.status/type/owner/dept/vendor) are new arrays every render, so key
    // off the URL's own string form instead of the arrays themselves.
  }, [state, params.toString(), sort])

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

  const FilterField = ({ label, children }) => (
    <label className="block text-xs mb-3">
      <span className="block text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  )

  return (
    <Page wide title="Contracts" actions={can.add && <Link to="/contracts/new" className={btnPrimary}><Plus size={15} /> New contract</Link>}>
      <ErrorMsg error={state.error} />
      <div className="flex flex-col md:flex-row gap-5 items-start">
        <aside className={`w-full ${filtersCollapsed ? 'md:w-12' : 'md:w-64'} shrink-0 md:sticky md:top-20 bg-white rounded-xl shadow-sm border border-gray-100 p-4 transition-[width] duration-150`}>
          <div className={`flex items-center gap-2 mb-3 ${filtersCollapsed ? 'justify-center' : 'justify-between'}`}>
            {!filtersCollapsed && (
              <h2 className="font-semibold text-gray-800 text-sm">
                Filters{filtersActive && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-brand align-middle" title="Filters active" />}
              </h2>
            )}
            <div className="flex items-center gap-2">
              {!filtersCollapsed && (
                <button type="button" className="text-xs font-medium text-brand hover:underline disabled:text-gray-300 disabled:no-underline" onClick={clearFilters} disabled={!filtersActive}>Clear all</button>
              )}
              <button
                type="button"
                onClick={toggleFiltersCollapsed}
                title={filtersCollapsed ? 'Show filters' : 'Collapse filters'}
                className="text-gray-400 hover:text-gray-700 hover:bg-gray-50 p-1 rounded"
              >
                {filtersCollapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
              </button>
            </div>
          </div>

          {!filtersCollapsed && (
            <>
              <FilterField label="Search"><input className={inputCls} placeholder="Title, vendor, tag…" value={f.q} onChange={e => set('q', e.target.value)} /></FilterField>
              <FilterField label="Type">
                <MultiSelect value={f.type} onChange={arr => setMulti('type', arr)} placeholder="All types"
                  options={(state.types || []).map(t => ({ value: t.id, label: t.name }))} />
              </FilterField>
              <FilterField label="Status">
                <MultiSelect value={f.status} onChange={arr => setMulti('status', arr)} placeholder="All statuses"
                  options={Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
              </FilterField>
              <FilterField label="Owner">
                <MultiSelect value={f.owner} onChange={arr => setMulti('owner', arr)} placeholder="All owners"
                  options={(state.directory || []).map(p => ({ value: p.id, label: p.display_name }))} />
              </FilterField>
              <FilterField label="Department">
                <MultiSelect value={f.dept} onChange={arr => setMulti('dept', arr)} placeholder="All departments"
                  options={departments.map(d => ({ value: d, label: d }))} />
              </FilterField>
              <FilterField label="Vendor">
                <MultiSelect value={f.vendor} onChange={arr => setMulti('vendor', arr)} placeholder="All vendors"
                  options={(state.counterparties || []).map(cp => ({ value: cp.id, label: cp.name }))} />
              </FilterField>
              <div className="grid grid-cols-2 gap-2">
                <FilterField label="Value min"><input type="number" min="0" className={inputCls} value={f.valueMin} onChange={e => set('valueMin', e.target.value)} /></FilterField>
                <FilterField label="Value max"><input type="number" min="0" className={inputCls} value={f.valueMax} onChange={e => set('valueMax', e.target.value)} /></FilterField>
              </div>
              <FilterField label="Signed after"><input type="date" className={inputCls} value={f.signedFrom} onChange={e => set('signedFrom', e.target.value)} /></FilterField>
              <FilterField label="Signed before"><input type="date" className={inputCls} value={f.signedTo} onChange={e => set('signedTo', e.target.value)} /></FilterField>
              <FilterField label="Last renewed after"><input type="date" className={inputCls} value={f.renewFrom} onChange={e => set('renewFrom', e.target.value)} /></FilterField>
              <FilterField label="Last renewed before"><input type="date" className={inputCls} value={f.renewTo} onChange={e => set('renewTo', e.target.value)} /></FilterField>
            </>
          )}
        </aside>

        <div className="flex-1 min-w-0 w-full">
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
                  <Th k="title">Title</Th><Th k="counterparty">Vendor</Th><Th k="type">Type</Th><Th k="status">Status</Th>
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
                      <td className="px-3 py-2" title={c.type?.name}>{typeAbbrev(c.type?.name)}</td>
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
        </div>
      </div>
    </Page>
  )
}
