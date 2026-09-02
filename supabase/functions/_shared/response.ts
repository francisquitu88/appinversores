function headersFor(request?: Request): Record<string, string> {
  const allowedOrigin = Deno.env.get('CORS_ORIGIN')
  const origin = request?.headers.get('origin')
  return { ...(allowedOrigin && origin === allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin, Vary: 'Origin' } : {}), 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}
export function jsonResponse(body: unknown, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headersFor(request), 'Content-Type': 'application/json' } })
}
export function errorResponse(code: string, message: string, status = 400, request?: Request): Response {
  return jsonResponse({ success: false, error: { code, message } }, status, request)
}
export function ok(data: unknown, request?: Request): Response { return jsonResponse({ success: true, data }, 200, request) }
export function handleOptions(request: Request): Response | null { return request.method === 'OPTIONS' ? new Response('ok', { headers: headersFor(request) }) : null }
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
}
