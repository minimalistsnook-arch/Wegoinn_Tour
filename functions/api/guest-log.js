// Cloudflare Pages Function. Appends each guest check-in to the Google Sheet
// through a Google Apps Script web app (wegoinn/google-apps-script/guest-log.gs).
// Secrets stay in server environment variables: GOOGLE_SHEET_WEBHOOK_URL, GOOGLE_SHEET_WEBHOOK_SECRET.
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
export async function onRequest({ request, env }) {
  const configured = Boolean(env.GOOGLE_SHEET_WEBHOOK_URL && env.GOOGLE_SHEET_WEBHOOK_SECRET && env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
  if (request.method === 'GET') return json({ configured });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!configured) return json({ error: 'Guest log is not configured' }, 503);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Invalid origin' }, 403);
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Sign in required' }, 401);
  let step = 'profile';
  try {
    // Nickname and profile id come from the database, not from the browser.
    const profile = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_my_profile`, { method: 'POST', headers: { authorization, apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
    const profileText = profile.ok ? await profile.text() : '';
    let me = null;
    try { me = profileText ? JSON.parse(profileText)[0] : null; } catch {
      let host = 'invalid URL';
      try { host = new URL(env.SUPABASE_URL).host; } catch { /* reported as invalid */ }
      return json({ error: 'Guest log unavailable', reason: `profile: non-JSON reply (HTTP ${profile.status}, ${profile.headers.get('Content-Type') || 'no type'}) from ${host}` }, 502);
    }
    if (!me) return json({ error: 'Guest profile required' }, 403);
    const raw = await request.text();
    if (raw.length > 4000) return json({ error: 'Request too long' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const reservation = text(body.reservation, 64);
    const avatarUrl = text(body.avatarUrl, 1000);
    if (!reservation) return json({ error: 'Reservation name or number is required' }, 400);
    if (avatarUrl && !avatarUrl.startsWith(`${env.SUPABASE_URL}/storage/v1/object/public/`)) return json({ error: 'Invalid photo' }, 400);
    step = 'webhook';
    const response = await fetch(env.GOOGLE_SHEET_WEBHOOK_URL.trim(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.GOOGLE_SHEET_WEBHOOK_SECRET.trim(), reservation, nickname: me.nickname, avatarUrl, profileId: me.id }),
      signal: AbortSignal.timeout(10000),
    });
    // The reason (never the secret) is returned so a broken setup can be told apart from the browser console.
    if (!response.ok) return json({ error: 'Guest log unavailable', reason: `sheet webhook HTTP ${response.status}` }, 502);
    const result = await response.json().catch(() => null);
    if (!result?.ok) return json({ error: 'Guest log unavailable', reason: result?.error ? `sheet webhook: ${result.error}` : 'sheet webhook did not return JSON' }, 502);
    return json({ ok: true });
  } catch (err) {
    // Name the URL's shape (never the URL or secret) so a mistyped webhook URL can be spotted.
    let detail = '';
    if (step === 'webhook') {
      const url = env.GOOGLE_SHEET_WEBHOOK_URL.trim();
      let shape = 'not a URL';
      try { const u = new URL(url); shape = `${u.protocol}//${u.host}${u.pathname.endsWith('/exec') ? ' …/exec' : ` …${u.pathname.slice(-5)}`}`; } catch { /* reported as not a URL */ }
      detail = ` (${String(err?.message || '').split(url).join('<url>').slice(0, 120)}; URL ${shape}, ${url.length} chars)`;
    }
    return json({ error: 'Guest log unavailable', reason: `${step}: ${err?.name || 'request failed'}${detail}` }, 502);
  }
}
