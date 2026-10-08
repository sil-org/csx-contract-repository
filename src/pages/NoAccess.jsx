import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { signOut } from '../lib/auth'

// Signed in with a valid SIL account but no contract role yet (R-A5).
export default function NoAccess() {
  const { session, profile, contractRole, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>
  if (!session) return <Navigate to="/" replace />
  if (contractRole) return <Navigate to="/dashboard" replace />

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md bg-white rounded-2xl shadow-lg p-10 text-center">
        <img src="/sil-logo.png" alt="SIL" className="h-12 mx-auto mb-5" />
        <h1 className="font-display text-2xl font-bold text-brand mb-2">Access needed</h1>
        <p className="text-gray-600 text-sm mb-1">You're signed in as <strong>{profile?.primary_email}</strong>, but you haven't been given access to the Contract Repository yet.</p>
        <p className="text-gray-500 text-sm mb-6">Ask a Contract Repository admin to grant you a role.</p>
        <button onClick={signOut} className="text-brand text-sm hover:underline">Sign out</button>
      </div>
    </div>
  )
}
