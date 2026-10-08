import { supabase } from './supabase'

// Document flow (spec §3). The browser never sees AWS credentials:
//   1. hash the file locally (SHA-256)
//   2. ask contract-documents for a short-lived upload URL (it checks permissions)
//   3. PUT the file straight to S3 with the checksum header — S3 rejects any mismatch
//   4. ask contract-documents to register it — it re-checks the object in S3 and records
//      the exact S3 version in the database
// Files are immutable once registered; "replacing" one uploads a new version.

export const MAX_BYTES = 50 * 1024 * 1024
export const ALLOWED_TYPES = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
}

async function call(body) {
  const { data, error } = await supabase.functions.invoke('contract-documents', { body })
  if (error) {
    let message = error.message
    try { message = (await error.context.json()).error || message } catch { /* keep generic message */ }
    throw new Error(message)
  }
  return data
}

export async function sha256Hex(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function uploadDocument({ contractId, file, role, changeNote, docKey, onStatus = () => {} }) {
  if (!ALLOWED_TYPES[file.type]) throw new Error('Allowed file types: PDF, DOCX, XLSX, PNG, JPEG.')
  if (file.size > MAX_BYTES) throw new Error('Files must be 50 MB or smaller.')
  if (role === 'original' && file.type !== 'application/pdf') throw new Error('The executed original must be a PDF.')

  onStatus('Checking file…')
  const sha256 = await sha256Hex(file)

  onStatus('Requesting upload…')
  const { url, key, headers } = await call({
    action: 'upload-url', contract_id: contractId, filename: file.name,
    content_type: file.type, size_bytes: file.size, sha256,
  })

  onStatus('Uploading…')
  const put = await fetch(url, { method: 'PUT', headers, body: file })
  if (!put.ok) throw new Error(`Upload failed (${put.status}). Check that the storage bucket allows this site (CORS).`)

  onStatus('Recording…')
  return call({
    action: 'register', contract_id: contractId, key, role, filename: file.name,
    content_type: file.type, sha256, change_note: changeNote, doc_key: docKey || null,
  })
}

export async function openDocument(documentId) {
  const { url } = await call({ action: 'download-url', document_id: documentId })
  window.open(url, '_blank', 'noopener')
}

export async function listDocuments(contractId) {
  const { data, error } = await supabase.from('contract_documents').select('*').eq('contract_id', contractId)
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return data
}
