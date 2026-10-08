import { useEffect, useState } from 'react'
import { listAdminUsers, setUserRole } from '../../lib/contracts'
import { ROLE_LABELS } from '../../lib/format'
import { Page, Card, ErrorMsg, Loading, inputCls } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'

const DESCRIPTIONS = {
  viewer: 'search and view contracts they are allowed to see',
  contributor: 'add contracts and upload files; edit contracts they own or back up',
  auditor: 'read-only access to everything, including the audit log',
  admin: 'manage users, types, settings and edit any contract',
}

// Contract roles are separate from license-manager roles: being a license-manager
// admin gives no access here.
export default function AdminUsers() {
  const { profile } = useAuth()
  const [state, setState] = useState({ loading: true })
  const [q, setQ] = useState('')
  const [err, setErr] = useState(null)
  const load = () => listAdminUsers().then(users => setState({ loading: false, users })).catch(error => setState({ loading: false, error }))
  useEffect(() => { load() }, [])

  async function change(u, role) {
    setErr(null)
    try { await setUserRole(u.profile_id, role, profile.id); await load() } catch (e) { setErr(e); load() }
  }
  const users = (state.users || []).filter(u => !q || `${u.display_name} ${u.primary_email}`.toLowerCase().includes(q.toLowerCase()))
  const granted = users.filter(u => u.role), others = users.filter(u => !u.role)

  const Row = u => (
    <tr key={u.profile_id}>
      <td className="px-3 py-2">{u.display_name}<div className="text-xs text-gray-400">{u.primary_email}</div></td>
      <td className="px-3 py-2">
        <select className={inputCls + ' max-w-[11rem]'} value={u.role || ''} onChange={e => change(u, e.target.value)}>
          <option value="">No access</option>
          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </td>
    </tr>
  )

  return (
    <Page title="Users & roles">
      <ErrorMsg error={state.error || err} />
      <Card>
        <ul className="text-xs text-gray-500 space-y-0.5">
          {Object.entries(DESCRIPTIONS).map(([k, v]) => <li key={k}><strong>{ROLE_LABELS[k]}</strong> — {v}</li>)}
        </ul>
        <p className="text-xs text-gray-400 mt-2">People appear here after they have signed in once. The contract owner/backup is chosen per contract, not here.</p>
      </Card>
      <input className={inputCls + ' mb-3'} placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} />
      {state.loading ? <Loading /> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm"><tbody className="divide-y divide-gray-100">
            {granted.map(Row)}
            {granted.length > 0 && others.length > 0 && <tr><td colSpan={2} className="px-3 py-1.5 bg-gray-50 text-xs font-semibold text-gray-500">No contract access</td></tr>}
            {others.map(Row)}
          </tbody></table>
        </div>
      )}
    </Page>
  )
}
