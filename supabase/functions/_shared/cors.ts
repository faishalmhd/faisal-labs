const configuredOrigin = Deno.env.get('APP_ORIGIN');

export function corsHeaders(request: Request): HeadersInit {
  const requestOrigin = request.headers.get('origin') ?? '';
  const origin = configuredOrigin && configuredOrigin !== '*'
    ? (requestOrigin === configuredOrigin ? configuredOrigin : configuredOrigin)
    : '*';

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function preflightResponse(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
