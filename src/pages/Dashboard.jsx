import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listContracts, listDecisions, getDirectory } from '../lib/contracts'
import { fmtDate, daysUntil } from '../lib/format'
import { Page, Card, ErrorMsg, Loading, StatusBadge } from '../components/ui'
import { useAuth } from '../context/AuthContext'

// "Coming due" (R-R8): active contracts by upcoming NOTICE deadline — the date that
// actually protects the organization — plus overdue items and contracts awaiting a decision.
const BUCKETS = [
  { key: 'overdue', label: 'Past notice deadline', test: d => d < 0, tone: 'text-red-700 bg-red-50 border-red-200' },
  { key: '30', label: 'Within 30 days', test: d => d >= 0 && d <= 30, tone: 'text-amber-800 bg-amber-50 border-amber-200' },
  { key: '60', label: '31–60 days', test: d => d > 30 && d <= 60, tone: 'text-yellow-800 bg-yellow-50 border-yellow-200' },
  { key: '90', label: '61–90 days', test: d => d > 60 && d <= 90, tone: 'text-blue-800 bg-blue-50 border-blue-200' },
  { key: '180', label: '91–180 days', test: d => d > 90 && d <= 180, tone: 'text-gray-700 bg-gray-50 border-gray-200' },
]

export default function Dashboard() {
  const { profile } = useAuth()
  const [state, setState] = useState({ loading: true })
  const [mineOnly, setMineOnly] = useState(false)

  useEffect(() => {
    Promise.all([listContracts(), listDecisions(), getDirectory()])
      .then(([contracts, decisions, directory]) => setState({ loading: false, contracts, decisions, directory }))
      .catch(error => setState({ loading: false, error }))
  }, [])

  const { rows, drafts, noReminders } = useMemo(() => {
    if (!state.contracts) return { rows: [], drafts: 0, noReminders: [] }
    const decided = new Set((state.decisions || []).map(d => `${d.contract_id}|${d.notice_deadline}`))
    const mine = c => !mineOnly || c.owner_id === profile?.id || c.backup_owner_id === profile?.id
    const active = state.contracts.filter(c => c.status === 'active' && mine(c))
    const rows = active.filter(c => c.notice_deadline).map(c => ({
      ...c, days: daysUntil(c.notice_deadline), decided: decided.has(`${c.id}|${c.notice_deadline}`),
    })).sort((a, b) => a.days - b.days)
    return {
      rows,
      drafts: state.contracts.filter(c => c.status === 'draft' && mine(c)).length,
      noReminders: active.filter(c => !c.reminders_enabled),
    }
  }, [state, mineOnly, profile])

  const owner = id => state.directory?.find(p => p.id === id)?.display_name || '—'

  return (
    <Page title="Coming due" actions={
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} /> My contracts only
      </label>
    }>
      <ErrorMsg error={state.error} />
      {state.loading ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            {BUCKETS.map(b => {
              const n = rows.filter(r => b.test(r.days) && !(b.key === 'overdue' && r.decided)).length
              return (
                <div key={b.key} className={`rounded-xl border p-3 ${b.tone}`}>
                  <div className="text-2xl font-bold">{n}</div>
                  <div className="text-xs font-medium">{b.label}</div>
                </div>
              )
            })}
          </div>

          {BUCKETS.map(b => {
            // Past-deadline contracts that already have a recorded decision are settled; don't list them.
            const items = rows.filter(r => b.test(r.days) && !(b.key === 'overdue' && r.decided))
            if (!items.length) return null
            return (
              <Card key={b.key} title={`${b.label} (${items.length})`}>
                <ul className="divide-y divide-gray-100">
                  {items.map(r => (
                    <li key={r.id} className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <Link to={`/contracts/${r.id}`} className="font-medium text-brand hover:underline">{r.title}</Link>
                      <span className="text-sm text-gray-500">{r.counterparty?.name}</span>
                      <span className="text-sm text-gray-500">Owner: {owner(r.owner_id)}</span>
                      <span className="ml-auto text-sm">
                        <span className="font-semibold">{fmtDate(r.notice_deadline)}</span>
                        <span className="text-gray-400"> · expires {fmtDate(r.expiration_date)}</span>
                      </span>
                      {r.decided
                        ? <span className="text-xs font-semibold text-green-700 bg-green-50 rounded-full px-2 py-0.5">Decision recorded</span>
                        : <span className="text-xs font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">No decision yet</span>}
                    </li>
                  ))}
                </ul>
              </Card>
            )
          })}
          {!rows.some(r => r.days <= 180) && <Card><p className="text-sm text-gray-500">Nothing has a notice deadline in the next 180 days.</p></Card>}

          {(drafts > 0 || noReminders.length > 0) && (
            <Card title="Needs attention">
              <ul className="text-sm text-gray-700 space-y-1.5">
                {drafts > 0 && <li><Link className="text-brand hover:underline" to="/contracts?status=draft">{drafts} draft contract{drafts === 1 ? '' : 's'}</Link> — not active until the executed original is uploaded, or an admin records a "not on file" exception.</li>}
                {noReminders.map(c => <li key={c.id}><Link className="text-brand hover:underline" to={`/contracts/${c.id}`}>{c.title}</Link> <StatusBadge status={c.status} /> — reminders are turned off.</li>)}
              </ul>
            </Card>
          )}
        </>
      )}
    </Page>
  )
}
