// Small display helpers shared across pages.

export function fmtDate(d) {
  if (!d) return '—'
  // Dates are plain calendar dates (YYYY-MM-DD) — parse as UTC so they never shift a day.
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function fmtDateTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

export function fmtBytes(n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function fmtMoney(amount, currency) {
  if (amount == null || amount === '') return '—'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount)
  } catch {
    return `${amount} ${currency || ''}`.trim()
  }
}

// Whole days from today (local calendar day) until a YYYY-MM-DD date. Negative = past.
export function daysUntil(d) {
  if (!d) return null
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((new Date(d + 'T00:00:00Z').getTime() - today) / 86400000)
}

// Shortens a contract type name to its acronym where the name plainly carries
// one — a trailing "(MOU)"/"(SOW)" or a short all-caps segment after a slash
// (e.g. a future "Non-disclosure agreement / NDA"). Otherwise returns the name
// unchanged (e.g. "Other", "Software subscription / system") rather than guess.
export function typeAbbrev(name) {
  if (!name) return ''
  const paren = name.match(/\(([A-Za-z0-9&-]{2,8})\)\s*$/)
  if (paren) return paren[1]
  const afterSlash = name.split('/').pop().trim()
  if (afterSlash !== name && afterSlash.length <= 8 && /[A-Z]/.test(afterSlash) && afterSlash === afterSlash.toUpperCase()) {
    return afterSlash
  }
  return name
}

export const STATUS_LABELS = {
  draft: 'Draft', active: 'Active', expired: 'Expired',
  terminated: 'Terminated', superseded: 'Superseded', completed: 'Completed',
}
export const RENEWAL_LABELS = { none: 'None', automatic: 'Automatic', option_to_renew: 'Option to renew', manual: 'Manual (mutual consent)' }
export const SIGN_ON_LABELS = { google: 'Google', saml: 'SAML', local: 'Local account' }
export const DOC_ROLE_LABELS = {
  original: 'Original (executed)', amendment: 'Amendment', exhibit: 'Exhibit / Schedule',
  correspondence: 'Correspondence', msa: 'MSA copy', other: 'Other',
}
export const DECISION_LABELS = { renew: 'Renew', renegotiate: 'Renegotiate', terminate: 'Terminate', no_action: 'No action needed' }
export const ROLE_LABELS = { viewer: 'Viewer', contributor: 'Contributor', auditor: 'Auditor', admin: 'Admin' }

export const PROVISIONS = [
  ['confidentiality', 'Confidentiality'], ['auto_renewal', 'Auto-renewal'], ['assignment_consent', 'Assignment consent'],
  ['indemnification', 'Indemnification'], ['limitation_of_liability', 'Limitation of liability'],
  ['data_protection', 'Data protection'], ['termination_for_convenience', 'Termination for convenience'],
  ['non_solicit', 'Non-solicit'],
]
