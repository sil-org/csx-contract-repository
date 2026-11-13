import { supabase } from './supabase'

// All reads/writes go straight to Postgres under RLS (supabase/contracts/01_contracts_schema.sql);
// the database, not this file, decides who can see or change what.

const CONTRACT_SELECT = '*, type:contract_types(id, name, form_kind), counterparty:contract_counterparties(id, name)'

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

export async function getDirectory() {
  return unwrap(await supabase.rpc('contract_directory'))
}

export async function listContracts() {
  return unwrap(await supabase.from('contracts').select(CONTRACT_SELECT).order('title').limit(2000))
}

export async function getContract(id) {
  return unwrap(await supabase.from('contracts').select(CONTRACT_SELECT).eq('id', id).maybeSingle())
}

export async function listTypes({ includeInactive = false } = {}) {
  let q = supabase.from('contract_types').select('*').order('sort_order').order('name')
  if (!includeInactive) q = q.eq('active', true)
  return unwrap(await q)
}

export async function listCounterparties() {
  return unwrap(await supabase.from('contract_counterparties').select('id, name').order('name'))
}

// Find a counterparty by name (case-insensitive) or create it — avoids duplicates (spec §4.1).
export async function findOrCreateCounterparty(name) {
  const clean = name.trim()
  const { data: existing, error } = await supabase.from('contract_counterparties').select('id, name').ilike('name', clean.replace(/[%_]/g, '\\$&')).limit(1)
  if (error) throw error
  if (existing?.length) return existing[0].id
  const { data, error: insErr } = await supabase.from('contract_counterparties').insert({ name: clean }).select('id').single()
  if (insErr) throw insErr
  return data.id
}

export async function saveContract(id, fields) {
  if (id) return unwrap(await supabase.from('contracts').update(fields).eq('id', id).select('id').single())
  return unwrap(await supabase.from('contracts').insert(fields).select('id').single())
}

export async function listDecisions(contractIds) {
  let q = supabase.from('contract_decisions').select('*').order('decided_at', { ascending: false })
  if (contractIds) q = q.in('contract_id', contractIds)
  return unwrap(await q)
}

export async function recordDecision({ contractId, noticeDeadline, decision, rationale, profileId }) {
  return unwrap(await supabase.from('contract_decisions').insert({
    contract_id: contractId, notice_deadline: noticeDeadline, decision, rationale: rationale || null, decided_by: profileId,
  }))
}

export async function listMilestones(contractId) {
  return unwrap(await supabase.from('contract_milestones').select('*').eq('contract_id', contractId).order('due_on'))
}
export async function addMilestone(contractId, dueOn, description) {
  return unwrap(await supabase.from('contract_milestones').insert({ contract_id: contractId, due_on: dueOn, description }))
}
export async function setMilestoneDone(id, done) {
  return unwrap(await supabase.from('contract_milestones').update({ completed_at: done ? new Date().toISOString() : null }).eq('id', id))
}
export async function deleteMilestone(id) {
  return unwrap(await supabase.from('contract_milestones').delete().eq('id', id))
}

export async function listLinks(contractId) {
  return unwrap(await supabase.from('contract_links').select('*').eq('contract_id', contractId).order('added_at'))
}
export async function addLink(contractId, url, label, profileId) {
  return unwrap(await supabase.from('contract_links').insert({ contract_id: contractId, url, label: label || 'Working copy', added_by: profileId }))
}
export async function deleteLink(id) {
  return unwrap(await supabase.from('contract_links').delete().eq('id', id))
}

export async function listAccess(contractId) {
  return unwrap(await supabase.from('contract_access').select('profile_id').eq('contract_id', contractId))
}
export async function grantAccess(contractId, profileId, grantedBy) {
  return unwrap(await supabase.from('contract_access').insert({ contract_id: contractId, profile_id: profileId, granted_by: grantedBy }))
}
export async function revokeAccess(contractId, profileId) {
  return unwrap(await supabase.from('contract_access').delete().eq('contract_id', contractId).eq('profile_id', profileId))
}

// Current signatory_name/signatory_email on `contracts` are a synced cache of the latest row here
// on or before today (supabase/contracts/09_responsible_party_history.sql) -- add a dated entry
// rather than editing those columns directly, so the history stays accurate for long-running contracts.
export async function listSignatories(contractId) {
  return unwrap(await supabase.from('contract_signatories').select('*').eq('contract_id', contractId).order('start_date', { ascending: false }))
}
export async function addSignatory(contractId, { name, email, start_date, note }, createdBy) {
  return unwrap(await supabase.from('contract_signatories').insert({
    contract_id: contractId, name, email: email || null, start_date, note: note || null, created_by: createdBy,
  }))
}
export async function deleteSignatory(id) {
  return unwrap(await supabase.from('contract_signatories').delete().eq('id', id))
}

export async function listRelated(contractId) {
  return unwrap(await supabase.from('contracts').select('id, title, status, amends_id').eq('amends_id', contractId).order('title'))
}

export async function listAudit({ contractId, limit = 200 } = {}) {
  let q = supabase.from('contract_audit_log').select('*').order('at', { ascending: false }).limit(limit)
  if (contractId) q = q.eq('contract_id', contractId)
  return unwrap(await q)
}

// ── admin ────────────────────────────────────────────────────────────────────
// People who currently HAVE a contract role (a short list; everyone else is found via searchProfiles).
export async function listAdminUsers() {
  return unwrap(await supabase.rpc('contract_admin_users'))
}
// People WITHOUT a contract role matching `query` (name or email); admin only, capped server-side.
export async function searchProfiles(query) {
  return unwrap(await supabase.rpc('contract_search_profiles', { p_query: query, p_limit: 25 }))
}
export async function setUserRole(profileId, role, grantedBy) {
  if (!role) return unwrap(await supabase.from('contract_roles').delete().eq('profile_id', profileId))
  return unwrap(await supabase.from('contract_roles').upsert({ profile_id: profileId, role, granted_by: grantedBy }))
}

export async function getSettings() {
  const rows = unwrap(await supabase.from('contract_settings').select('*'))
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}
export async function saveSetting(key, value) {
  return unwrap(await supabase.from('contract_settings').upsert({ key, value }))
}

export async function saveType(type) {
  return unwrap(await supabase.from('contract_types').upsert(type))
}

export async function listReminderLog(limit = 200) {
  return unwrap(await supabase.from('contract_reminder_log').select('*, contract:contracts(title)').order('created_at', { ascending: false }).limit(limit))
}
