import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { resolveProfile } from '../lib/auth'

const AuthContext = createContext(null)

// `profile` comes from the shared auth kernel (same as license-manager).
// `contractRole` is this app's own role (viewer | contributor | auditor | admin),
// stored in contract_roles — profile.role is license-manager's and is NOT used here.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [profile, setProfile] = useState(null)
  const [contractRole, setContractRole] = useState(undefined) // undefined = loading, null = no access
  const [authError, setAuthError] = useState(null)

  async function loadIdentity(user) {
    try {
      const p = await resolveProfile(user)
      const { data, error } = await supabase.rpc('contract_my_role')
      if (error) throw error
      setProfile(p)
      setContractRole(data ?? null)
      setAuthError(null)
    } catch (e) {
      setAuthError(e.message || 'Could not load your profile')
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) loadIdentity(session.user)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session?.user) {
        loadIdentity(session.user)
      } else {
        setProfile(null)
        setContractRole(undefined)
        setAuthError(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function refreshProfile() {
    const { data: { session: s } } = await supabase.auth.getSession()
    if (s?.user) loadIdentity(s.user)
  }

  const loading = !authError && (session === undefined || (session !== null && (profile === null || contractRole === undefined)))

  return (
    <AuthContext.Provider value={{ session, profile, contractRole, loading, authError, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

// What each contract role may do in the UI. The database enforces the same rules (RLS);
// this only decides what to show.
export function useCan() {
  const { contractRole } = useAuth()
  return {
    add: contractRole === 'contributor' || contractRole === 'admin',
    admin: contractRole === 'admin',
    seeAudit: contractRole === 'admin' || contractRole === 'auditor',
  }
}
