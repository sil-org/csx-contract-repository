import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { signOut } from '../lib/auth'

// Guards a route. `roles` limits it to specific contract roles (e.g. ['admin']);
// omit it to allow anyone who has been given any contract role. Signed-in staff
// with no contract role land on /no-access (R-A5: no access until granted).
export default function RequireAuth({ children, roles }) {
  const { session, contractRole, loading, authError } = useAuth()

  if (authError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-red-600 text-sm max-w-md">{authError}</p>
        <button onClick={signOut} className="text-brand text-sm hover:underline">Sign out</button>
      </div>
    )
  }
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>
  if (!session) return <Navigate to="/" replace />
  if (!contractRole) return <Navigate to="/no-access" replace />
  if (roles && !roles.includes(contractRole)) return <Navigate to="/dashboard" replace />

  return children
}
