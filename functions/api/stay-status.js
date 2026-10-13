// Is the signed-in guest's stay still active? Ends when the Korean date passes the check-out date
// (enforced in the database) or when staff put "x" in column M of the guest's row in the Guest Log sheet.
// For an "x", this marks the stay ended in Supabase with the guest's own token (end_my_stay).
import { accessToken, sheetsRequest, TAB } from './guest-log.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const configured = (env, name) => typeof env[name] === 'string' && env[name].trim() !== '';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer \S+$/.test(authorization)) return json({ error: 'Sign in required' }, 401);
  if (!configured(env, 'SUPABASE_URL') || !configured(env, 'SUPABASE_ANON_KEY')) return json({ error: 'Stay check is not configured' }, 503);
  const supabaseUrl = env.SUPABASE_URL.trim().replace(/\/$/, '');
  const rpc = (name) => fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers: { authorization, apikey: env.SUPABASE_ANON_KEY.trim(), 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });

  const profile = await rpc('get_my_stay');
  if (!profile.ok) return json({ error: 'Guest profile unavailable', reason: `profile HTTP ${profile.status}` }, 502);
  const me = (await profile.json().catch(() => null))?.[0];
  // No active profile: the check-out date has passed or the stay was already ended.
  if (!me?.id) return json({ active: false, reason: 'checked_out' });
  if (me.role === 'admin') return json({ active: true });

  if (!configured(env, 'GOOGLE_SERVICE_ACCOUNT_JSON') || !configured(env, 'GOOGLE_SHEET_ID')) return json({ active: true, sheet: 'not configured' });
  try {
    const token = await accessToken(JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON));
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID.trim())}`;
    // F = Profile ID … M = staff check-out mark.
    const { values = [] } = await sheetsRequest(base, token, `/values/${encodeURIComponent(`'${TAB}'!F2:M`)}`);
    const marked = values.some((row) => String(row[0] ?? '').replace(/^'/, '').trim() === me.id && /^x$/i.test(String(row[7] ?? '').trim()));
    if (!marked) return json({ active: true });
    const ended = await rpc('end_my_stay');
    if (!ended.ok) return json({ error: 'Could not end the stay', reason: `end_my_stay HTTP ${ended.status}` }, 502);
    return json({ active: false, reason: 'sheet' });
  } catch (error) {
    // The sheet being unreachable must not lock guests out; the date rule still applies in the database.
    return json({ active: true, sheet: error?.message?.startsWith('Sheets API ') ? error.message : 'unavailable' });
  }
}
