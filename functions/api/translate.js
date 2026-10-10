// Cloudflare Pages Function. Secrets stay in server environment variables.
// API reference: https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export async function onRequest({ request, env }) {
  const configured = Boolean(env.GOOGLE_TRANSLATE_API_KEY && env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
  if (request.method === 'GET') return json({ configured });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!configured) return json({ error: 'Translation is not configured' }, 503);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Invalid origin' }, 403);
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Sign in required' }, 401);
  try {
    const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { authorization, apikey: env.SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(5000) });
    if (!auth.ok) return json({ error: 'Sign in required' }, 401);
    // A signed-in anonymous auth user must also have a registered guest profile.
    const profile = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_my_profile`, { method: 'POST', headers: { authorization, apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
    if (!profile.ok || !(await profile.json()).length) return json({ error: 'Guest profile required' }, 403);
    if (Number(request.headers.get('Content-Length')) > 16000) return json({ error: 'Text too long' }, 413);
    const raw = await request.text();
    if (raw.length > 16000) return json({ error: 'Text too long' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000 || !['en','ko','ja','zh'].includes(body.target)) return json({ error: 'Invalid text or language' }, 400);
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(env.GOOGLE_TRANSLATE_API_KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: body.text, target: body.target === 'zh' ? 'zh-CN' : body.target, format: 'text' }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return json({ error: 'Translation service unavailable' }, 502);
    const translatedText = (await response.json()).data?.translations?.[0]?.translatedText;
    if (typeof translatedText !== 'string') return json({ error: 'Invalid translation response' }, 502);
    return json({ translatedText });
  } catch { return json({ error: 'Translation service unavailable' }, 502); }
}
