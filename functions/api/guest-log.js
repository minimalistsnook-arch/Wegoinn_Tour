// Server-only service-account authentication; credentials never reach the browser.
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const HEADERS = ['Time (KST)', 'Reservation name / number', 'Nickname', 'Photo', 'Photo URL', 'Profile ID', 'Check in date', 'Check out date', 'Room number', 'Room type', 'Capacity', 'Role'];
const TAB = 'Guest Log';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const encodeJson = value => encode(new TextEncoder().encode(JSON.stringify(value)));

async function accessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encodeJson({ alg: 'RS256', typ: 'JWT' })}.${encodeJson({ iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
  const pem = credentials.private_key.replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${encode(signature)}` }), signal: AbortSignal.timeout(10000) });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.access_token) throw new Error(`Google authentication HTTP ${response.status}; check service account key`);
  return result.access_token;
}

async function sheetsRequest(base, token, path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const hint = response.status === 403 ? 'enable Sheets API and share the sheet with the service account as Editor' : response.status === 404 ? 'check spreadsheet ID and sharing permissions' : 'check Sheets API response';
    throw new Error(`Sheets API HTTP ${response.status}; ${hint}`);
  }
  if (!result) throw new Error('Sheets API returned invalid JSON');
  return result;
}

async function appendGuest(env, credentials, row) {
  const token = await accessToken(credentials);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID.trim())}`;
  const metadata = () => sheetsRequest(base, token, '?fields=sheets.properties.title');
  const hasTab = data => data.sheets?.some(sheet => sheet.properties?.title === TAB);
  if (!hasTab(await metadata())) {
    try {
      await sheetsRequest(base, token, ':batchUpdate', 'POST', { requests: [{ addSheet: { properties: { title: TAB } } }] });
    } catch (error) {
      // Concurrent first logins can both try to create the same tab.
      if (!hasTab(await metadata())) throw error;
    }
  }
  const range = encodeURIComponent(`'${TAB}'!A1:L1`);
  await sheetsRequest(base, token, `/values/${range}?valueInputOption=RAW`, 'PUT', { values: [HEADERS] });
  if (!row) return;
  const result = await sheetsRequest(base, token, `/values/${encodeURIComponent(`'${TAB}'!A:L`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, 'POST', { values: [row] });
  if (result.updates?.updatedRows !== 1) throw new Error('Sheets API did not confirm the saved row');
}

export async function onRequest({ request, env }) {
  const required = ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SHEET_ID', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const missing = required.filter(name => !text(env[name], 20000));
  if (request.method === 'GET') return json({ configured: missing.length === 0, provider: 'google-sheets', missing });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (missing.length) return json({ error: 'Guest log is not configured', missing }, 503);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Invalid origin' }, 403);
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer \S+$/.test(authorization)) return json({ error: 'Sign in required' }, 401);
  let step = 'profile';
  try {
    const supabaseUrl = env.SUPABASE_URL.trim().replace(/\/$/, '');
    const profile = await fetch(`${supabaseUrl}/rest/v1/rpc/get_my_stay`, { method: 'POST', headers: { authorization, apikey: env.SUPABASE_ANON_KEY.trim(), 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
    if (!profile.ok) return json({ error: 'Guest profile unavailable', reason: `profile HTTP ${profile.status}` }, profile.status === 401 || profile.status === 403 ? 401 : 502);
    const profiles = await profile.json().catch(() => null);
    if (!Array.isArray(profiles)) return json({ error: 'Guest log unavailable', reason: 'profile returned invalid JSON' }, 502);
    const me = profiles[0];
    if (!me?.id) return json({ error: 'Guest profile required' }, 403);
    const raw = await request.text();
    if (raw.length > 4000) return json({ error: 'Request too long' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid JSON' }, 400);
    const avatarUrl = text(me.avatar_url, 1000);

    if (avatarUrl && (!avatarUrl.startsWith(`${supabaseUrl}/storage/v1/object/public/`) || /["\r\n]/.test(avatarUrl))) return json({ error: 'Invalid photo' }, 400);
    step = 'credentials';
    let credentials;
    try { credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON); } catch { return json({ error: 'Guest log unavailable', reason: 'GOOGLE_SERVICE_ACCOUNT_JSON must contain the complete JSON key file' }, 503); }
    if (credentials?.type !== 'service_account' || !text(credentials.client_email, 500) || !text(credentials.private_key, 20000)) return json({ error: 'Guest log unavailable', reason: 'Service account JSON needs type, client_email and private_key' }, 503);
    step = 'google-sheets';
    // Prefix guest-supplied strings so USER_ENTERED cannot interpret them as formulas.
    const literal = value => `'${String(value ?? '')}`;
    const time = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date());
    await appendGuest(env, credentials, [literal(time), literal(me.role === 'admin' ? '운영자' : ''), literal(me.nickname), avatarUrl ? `=IMAGE("${avatarUrl}")` : '', literal(avatarUrl), literal(me.id), literal(me.check_in), literal(me.check_out), literal(me.room_number), literal(me.room_type), me.capacity ?? '', literal(me.role === 'admin' ? '운영자' : '손님')]);
    return json({ ok: true });
  } catch (error) {
    // Only our fixed diagnostics are exposed; key material and tokens remain private.
    const reason = error?.message?.startsWith('Sheets API ') || error?.message?.startsWith('Google authentication HTTP ') ? error.message : `${step}: ${error?.name || 'request failed'}`;
    return json({ error: 'Guest log unavailable', reason }, 502);
  }
}

// Prepare the extended header without creating a fictitious login record.
export async function prepareGuestSheet(env) {
  await appendGuest(env, JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON), null);
}
