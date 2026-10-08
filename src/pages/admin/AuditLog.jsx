import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listAudit, getDirectory } from '../../lib/contracts'
import { fmtDateTime } from '../../lib/format'
import { Page, ErrorMsg, Loading, inputCls } from '../../components/ui'

// Append-only record of who did what (spec §9). Read-only for admins and auditors.
export default function AuditLog() {
  const [state, setState] = useState({ loading: true })
  const [q, setQ] = useState('')
  useEffect(() => {
    Promise.all([listAudit({ limit: 500 }), getDirectory()])
      .then(([rows, directory]) => setState({ loading: false, rows, directory })).catch(error => setState({ loading: false, error }))
  }, [])
  const who = id => (id ? state.directory?.find(p => p.id === id)?.display_name || 'Unknown' : 'System')
  const rows = useMemo(() => (state.rows || []).filter(r => !q || `${who(r.profile_id)} ${r.action} ${r.entity} ${JSON.stringify(r.new_values)}`.toLowerCase().includes(q.toLowerCase())), [state, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const show = v => !v ? '' : Object.entries(v).map(([k, val]) => `${k}: ${JSON.stringify(val)}`).join('; ')
  return (
    <Page wide title="Audit log">
      <ErrorMsg error={state.error} />
      <input className={inputCls + ' mb-3'} placeholder="Filter by person, action, entity or value…" value={q} onChange={e => setQ(e.target.value)} />
      {state.loading ? <Loading /> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600"><tr>{['When', 'Who', 'Action', 'Record', 'Change'].map(h => <th key={h} className="text-left px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(r.at)}</td>
                  <td className="px-3 py-2">{who(r.profile_id)}{r.ip_address && <div className="text-gray-400">{r.ip_address}</div>}</td>
                  <td className="px-3 py-2">{r.action}</td>
                  <td className="px-3 py-2">{r.entity.replace('contract_', '')}{r.contract_id && <> · <Link className="text-brand hover:underline" to={`/contracts/${r.contract_id}`}>open</Link></>}</td>
                  <td className="px-3 py-2 text-gray-600 max-w-xl break-words">{r.old_values && <div className="text-gray-400">was: {show(r.old_values).slice(0, 300)}</div>}{show(r.new_values).slice(0, 300)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">Nothing recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-2">Showing up to the latest 500 events.</p>
    </Page>
  )
}
