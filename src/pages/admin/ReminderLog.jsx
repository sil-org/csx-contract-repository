import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listReminderLog } from '../../lib/contracts'
import { fmtDateTime, fmtDate } from '../../lib/format'
import { Page, ErrorMsg, Loading } from '../../components/ui'
import AdminTabs from '../../components/AdminTabs'

const KIND = k => k === 'escalation' ? 'Escalation' : k === 'passed_deadline' ? 'Passed deadline' : k === 'milestone' ? 'Milestone' : `${k.replace('notice_', '')}-day notice`

// Every reminder attempt (R-R10). Failed sends are retried automatically each day.
export default function ReminderLog() {
  const [state, setState] = useState({ loading: true })
  useEffect(() => { listReminderLog().then(rows => setState({ loading: false, rows })).catch(error => setState({ loading: false, error })) }, [])
  const failed = state.rows?.filter(r => r.status === 'failed').length || 0
  return (
    <Page wide title="Reminder log" tabs={<AdminTabs />}>
      <ErrorMsg error={state.error} />
      {failed > 0 && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{failed} failed send{failed === 1 ? '' : 's'} in this list. They are retried automatically on the next daily run.</div>}
      {state.loading ? <Loading /> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600"><tr>{['When', 'Contract', 'Reminder', 'Deadline', 'Sent to', 'Result'].map(h => <th key={h} className="text-left px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {state.rows.map(r => (
                <tr key={r.id} className={r.status === 'failed' ? 'bg-red-50/50' : ''}>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                  <td className="px-3 py-2"><Link className="text-brand hover:underline" to={`/contracts/${r.contract_id}`}>{r.contract?.title || r.contract_id}</Link></td>
                  <td className="px-3 py-2">{KIND(r.kind)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.notice_deadline)}</td>
                  <td className="px-3 py-2 text-xs">{r.recipients.join(', ')}</td>
                  <td className="px-3 py-2">{r.status === 'sent' ? <span className="text-green-700">Sent</span> : <span className="text-red-700" title={r.error}>Failed</span>}</td>
                </tr>
              ))}
              {!state.rows.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No reminders have been sent yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  )
}
