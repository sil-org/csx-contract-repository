// Shared helpers for this app's Edge Functions.

export function corsHeaders(req?: Request): Record<string, string> {
  // CONTRACTS_ALLOWED_ORIGINS: comma-separated list (e.g. "https://contracts.sil.org,http://localhost:5173").
  // Prefixed (not ALLOWED_ORIGINS) because Edge Function secrets are project-wide, shared with license-manager.
  const allowed = (Deno.env.get('CONTRACTS_ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map(s => s.trim())
  const origin = req?.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

export function json(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

// Constant-time string comparison (for shared secrets).
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a), y = enc.encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}
