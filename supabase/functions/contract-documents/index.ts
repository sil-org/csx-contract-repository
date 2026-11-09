import { createClient } from 'jsr:@supabase/supabase-js@2'
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from 'npm:@aws-sdk/client-s3@3.700.0'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.700.0'
import { corsHeaders, json } from '../_shared/http.ts'

// Issues short-lived S3 URLs for contract documents and registers uploads.
// The browser never holds AWS credentials and never gets a public link (R-A4).
//
// Deployed with --no-verify-jwt (like the other functions in this project —
// see supabase/functions/README.md); every request is authenticated here by
// validating the caller's Supabase access token, then authorised with the
// SAME checks RLS uses (contract_can_view_as / contract_can_edit_as).
//
// Actions (POST JSON, Authorization: Bearer <user access token>):
//   upload-url   { contract_id, filename, content_type, size_bytes, sha256 }
//                -> { url, key, headers }  PUT the file there with those headers
//   register     { contract_id, key, role, filename, content_type, sha256, change_note, doc_key? }
//                -> { id }  verifies the object exists with the expected checksum, then records it
//   download-url { document_id } -> { url }   (logged to the audit trail)
//
// Required secrets: CONTRACTS_AWS_ACCESS_KEY_ID, CONTRACTS_AWS_SECRET_ACCESS_KEY, CONTRACTS_AWS_REGION, CONTRACTS_BUCKET.
// Prefixed because Edge Function secrets are project-wide (shared with license-manager) —
// generic AWS_* names would collide with (or get clobbered by) another app's secrets.
// The AWS user needs only s3:PutObject / GetObject / GetObjectVersion on the bucket —
// deliberately NO delete permissions (infra/iam-policy.json).

const MAX_BYTES = 50 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png', 'image/jpeg',
])
const ROLES = new Set(['original', 'amendment', 'exhibit', 'correspondence', 'msa', 'other'])
const UPLOAD_TTL = 300
const DOWNLOAD_TTL = 60

const BUCKET = Deno.env.get('CONTRACTS_BUCKET')!
const s3 = new S3Client({
  region: Deno.env.get('CONTRACTS_AWS_REGION') ?? 'us-east-1',
  credentials: {
    accessKeyId: Deno.env.get('CONTRACTS_AWS_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('CONTRACTS_AWS_SECRET_ACCESS_KEY')!,
  },
})

const hexToBase64 = (hex: string) =>
  btoa(hex.match(/../g)!.map(h => String.fromCharCode(parseInt(h, 16))).join(''))
const base64ToHex = (b64: string) =>
  [...atob(b64)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
const isSha256Hex = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s)
const isUuid = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, '_').slice(0, 150) || 'file'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req)

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // ── authenticate: a real, unexpired Supabase session ─────────────────────
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Unauthorized' }, 401, req)
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401, req)

    const { data: link } = await admin.from('linked_accounts')
      .select('profile_id').eq('supabase_user_id', userData.user.id).maybeSingle()
    const profileId: string | undefined = link?.profile_id
    if (!profileId) return json({ error: 'No profile for this account' }, 403, req)

    const body = await req.json().catch(() => ({}))
    const can = async (fn: 'contract_can_view_as' | 'contract_can_edit_as', contractId: string) => {
      const { data, error } = await admin.rpc(fn, { p_profile: profileId, p_contract: contractId })
      if (error) throw error
      return data === true
    }

    // ── upload-url ───────────────────────────────────────────────────────────
    if (body.action === 'upload-url') {
      const { contract_id, filename, content_type, size_bytes, sha256 } = body
      if (!isUuid(contract_id) || typeof filename !== 'string' || !isSha256Hex(sha256)) {
        return json({ error: 'Invalid request' }, 400, req)
      }
      if (!ALLOWED_TYPES.has(content_type)) return json({ error: 'File type not allowed' }, 400, req)
      if (!Number.isInteger(size_bytes) || size_bytes <= 0 || size_bytes > MAX_BYTES) {
        return json({ error: 'File must be 1 byte to 50 MB' }, 400, req)
      }
      if (!(await can('contract_can_edit_as', contract_id))) return json({ error: 'Forbidden' }, 403, req)

      const key = `contracts/${contract_id}/${crypto.randomUUID()}/${safeName(filename)}`
      const checksum = hexToBase64(sha256.toLowerCase())
      // S3 itself rejects the upload if the bytes don't hash to `sha256` (and
      // Object Lock buckets require a checksum header on PutObject anyway).
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: content_type, ChecksumSHA256: checksum }),
        { expiresIn: UPLOAD_TTL, unhoistableHeaders: new Set(['x-amz-checksum-sha256']), signableHeaders: new Set(['content-type']) },
      )
      return json({
        url, key,
        headers: { 'Content-Type': content_type, 'x-amz-checksum-sha256': checksum },
      }, 200, req)
    }

    // ── register ─────────────────────────────────────────────────────────────
    if (body.action === 'register') {
      const { contract_id, key, role, filename, content_type, sha256, change_note, doc_key } = body
      if (!isUuid(contract_id) || typeof key !== 'string' || !key.startsWith(`contracts/${contract_id}/`) ||
          !ROLES.has(role) || typeof filename !== 'string' || !isSha256Hex(sha256) ||
          typeof change_note !== 'string' || !change_note.trim() || (doc_key != null && !isUuid(doc_key))) {
        return json({ error: 'Invalid request' }, 400, req)
      }
      if (!ALLOWED_TYPES.has(content_type)) return json({ error: 'File type not allowed' }, 400, req)
      if (!(await can('contract_can_edit_as', contract_id))) return json({ error: 'Forbidden' }, 403, req)

      // Trust S3, not the browser: confirm the object exists and its stored checksum matches.
      let head
      try {
        head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key, ChecksumMode: 'ENABLED' }))
      } catch (_e) {
        return json({ error: 'Upload not found in storage' }, 400, req)
      }
      if (!head.VersionId) return json({ error: 'Bucket versioning is not enabled' }, 500, req)
      if (!head.ChecksumSHA256 || base64ToHex(head.ChecksumSHA256) !== sha256.toLowerCase()) {
        return json({ error: 'Checksum mismatch' }, 400, req)
      }
      const size = Number(head.ContentLength ?? 0)
      if (size <= 0 || size > MAX_BYTES) return json({ error: 'Invalid file size' }, 400, req)

      const { data: id, error } = await admin.rpc('contract_register_document', {
        p_profile: profileId, p_contract: contract_id, p_doc_key: doc_key ?? null, p_role: role,
        p_filename: filename, p_content_type: content_type, p_size_bytes: size,
        p_sha256: sha256.toLowerCase(), p_s3_key: key, p_s3_version_id: head.VersionId,
        p_change_note: change_note.trim(),
      })
      if (error) return json({ error: error.message }, 400, req)
      return json({ id }, 200, req)
    }

    // ── download-url ─────────────────────────────────────────────────────────
    if (body.action === 'download-url') {
      if (!isUuid(body.document_id)) return json({ error: 'Invalid request' }, 400, req)
      const { data: doc } = await admin.from('contract_documents')
        .select('id, contract_id, s3_key, s3_version_id, filename, content_type')
        .eq('id', body.document_id).maybeSingle()
      // Same answer for "missing" and "not allowed": don't reveal which contracts exist.
      if (!doc || !(await can('contract_can_view_as', doc.contract_id))) return json({ error: 'Not found' }, 404, req)

      await admin.rpc('contract_log_access', {
        p_profile: profileId, p_contract: doc.contract_id, p_document: doc.id, p_action: 'download',
      })
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: BUCKET, Key: doc.s3_key, VersionId: doc.s3_version_id,   // pin the exact version
          ResponseContentType: doc.content_type,
          ResponseContentDisposition: `attachment; filename="${safeName(doc.filename)}"`,
        }),
        { expiresIn: DOWNLOAD_TTL },
      )
      return json({ url }, 200, req)
    }

    return json({ error: 'Unknown action' }, 400, req)
  } catch (e) {
    console.error('contract-documents error:', e)
    return json({ error: 'Internal error' }, 500, req)
  }
})
