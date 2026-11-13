import { useEffect, useRef, useState } from 'react'
import { UserPlus, Search } from 'lucide-react'
import { listAdminUsers, searchProfiles, setUserRole } from '../../lib/contracts'
import { ROLE_LABELS } from '../../lib/format'
import { Page, Card, ErrorMsg, Loading, inputCls } from '../../components/ui'
import AdminTabs from '../../components/AdminTabs'
import { useAuth } from '../../context/AuthContext'

const DESCRIPTIONS = {
  viewer: 'search and view contracts they are allowed to see',
  contributor: 'add contracts and upload files; edit contracts they own or back up',
  auditor: 'read-only access to everything, including the audit log',
  admin: 'manage users, types, settings and edit any contract',
}

// Contract roles are separate from license-manager roles: being a license-manager
// admin gives no access here. This page lists only people who HAVE a role; to give
// someone access, search for them under "Add a person" (the shared project has
// thousands of profiles, so they are never all loaded at once).
export default function AdminUsers() {
  const { profile } = useAuth()
  const [state, setState] = useState({ loading: true })
  const [filter, setFilter] = useState('')
  const [err, setErr] = useState(null)

// Only people who have a role: the pre-03 database function returned every profile, so don't trust it.
  const load = () => listAdminUsers().then(users => setState({ loading: false, users: users.filter(u => u.role) })).catch(error => setState({ loading: false, error }))
  useEffect(() => { load() }, [])

  async function change(u, role) {
    setErr(null)
    try { await setUserRole(u.profile_id, role, profile.id); await load() } catch (e) { setErr(e); load() }
  }

  const users = (state.users || []).filter(u => !filter || `${u.display_name} ${u.primary_email}`.toLowerCase().includes(filter.toLowerCase()))

  return (
    <Page title="Users & roles" tabs={<AdminTabs />}>
      <ErrorMsg error={state.error || err} />
      <AddPerson onAdded={load} grantedBy={profile?.id} setErr={setErr} />

      <Card title={`People with access${state.users ? ` (${state.users.length})` : ''}`}>
        <ul className="text-xs text-gray-500 space-y-0.5 mb-3">
          {Object.entries(DESCRIPTIONS).map(([k, v]) => <li key={k}><strong>{ROLE_LABELS[k]}</strong> — {v}</li>)}
        </ul>
        {(state.users?.length || 0) > 8 && (
          <input className={inputCls + ' mb-3'} placeholder="Filter this list…" value={filter} onChange={e => setFilter(e.target.value)} />
        )}
        {state.loading ? <Loading /> : (
          <table className="w-full text-sm"><tbody className="divide-y divide-gray-100">
            {users.map(u => (
              <tr key={u.profile_id}>
                <td className="py-2 pr-3">{u.display_name}<div className="text-xs text-gray-400">{u.primary_email}</div></td>
                <td className="py-2">
                  <select className={inputCls + ' max-w-[11rem]'} value={u.role} onChange={e => change(u, e.target.value)}>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    <option value="">Remove access</option>
                  </select>
                </td>
              </tr>
            ))}
            {!users.length && <tr><td className="py-4 text-center text-gray-400" colSpan={2}>No one matches.</td></tr>}
          </tbody></table>
        )}
      </Card>
    </Page>
  )
}

function AddPerson({ onAdded, grantedBy, setErr }) {
  const [q, setQ] = useState('')
  const [role, setRole] = useState('viewer')
  const [results, setResults] = useState(null)   // null = nothing searched yet
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(null)
  const seq = useRef(0)

  // Debounced server-side search; ignores out-of-order responses.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults(null); return }
    const mine = ++seq.current
    setBusy(true)
    const t = setTimeout(() => {
      searchProfiles(term)
        .then(r => { if (mine === seq.current) setResults(r) })
        .catch(e => { if (mine === seq.current) setErr(e) })
        .finally(() => { if (mine === seq.current) setBusy(false) })
    }, 300)
    return () => clearTimeout(t)
  }, [q, setErr])

  async function add(p) {
    setErr(null)
    try {
      await setUserRole(p.profile_id, role, grantedBy)
      setAdded(`${p.display_name} added as ${ROLE_LABELS[role]}.`)
      setResults(r => r.filter(x => x.profile_id !== p.profile_id))
      await onAdded()
    } catch (e) { setErr(e) }
  }

  return (
    <Card title="Add a person">
      <div className="flex flex-wrap gap-2 mb-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
          <input className={inputCls + ' pl-9'} placeholder="Search by name or email, e.g. scott_kohler" value={q}
            onChange={e => { setQ(e.target.value); setAdded(null) }} aria-label="Search for a person" />
        </div>
        <select className={inputCls + ' max-w-[11rem]'} value={role} onChange={e => setRole(e.target.value)} aria-label="Role to give">
          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {added && <p className="text-sm text-green-700 mb-2">{added}</p>}
      {busy && <p className="text-xs text-gray-400">Searching…</p>}
      {!busy && results && (
        <ul className="divide-y divide-gray-100">
          {results.map(p => (
            <li key={p.profile_id} className="py-2 flex items-center gap-3 text-sm">
              <span className="min-w-0">{p.display_name}<span className="block text-xs text-gray-400 truncate">{p.primary_email}</span></span>
              <button className="ml-auto inline-flex items-center gap-1.5 bg-brand hover:bg-brand-dark text-white text-xs font-semibold rounded-lg px-3 py-1.5" onClick={() => add(p)}>
                <UserPlus size={13} /> Add as {ROLE_LABELS[role]}
              </button>
            </li>
          ))}
          {!results.length && (
            <li className="py-2 text-sm text-gray-500">
              No one without access matches “{q.trim()}”. People appear here once they have signed in to a SIL app (or been imported into the license manager),
              and anyone who already has access is in the list below.
            </li>
          )}
          {results.length >= 25 && <li className="py-2 text-xs text-gray-400">Showing the first 25 — type more of the name or email to narrow it down.</li>}
        </ul>
      )}
      {!results && !busy && q.trim().length < 2 && <p className="text-xs text-gray-400">Type at least two letters of a name or email.</p>}
    </Card>
  )
}
