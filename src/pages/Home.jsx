import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { signInWithSSO } from '../lib/auth'

export default function Home() {
  const { session, profile, loading, authError } = useAuth()

  if (authError) return <div className="min-h-screen flex items-center justify-center px-4 text-center text-red-600 text-sm">{authError}</div>
  if (loading) return <LoadingScreen />

  if (session && profile) return <Navigate to="/dashboard" replace />

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-10 text-center">
        <img src="/sil-logo.png" alt="SIL" className="h-14 mx-auto mb-6" />
        <h1 className="font-display text-3xl font-bold text-brand mb-2">
          Contract Repository
        </h1>
        <p className="text-gray-500 mb-8 text-sm">Repository of record for MOUs, SOWs and vendor contracts</p>

        <button
          onClick={signInWithSSO}
          className="w-full flex items-center justify-center gap-3 bg-brand hover:bg-brand-dark text-white rounded-lg px-6 py-3 text-sm font-semibold shadow-sm transition"
        >
          <SSOIcon />
          Sign in with SSO
        </button>

        <p className="mt-6 text-xs text-gray-400">
          Restricted to SIL staff. Sign in with your SIL single sign-on account.
        </p>
      </div>
    </div>
  )
}

function SSOIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
    </svg>
  )
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center text-gray-400">
      Loading…
    </div>
  )
}
