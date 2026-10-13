// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { onRequest } from '../../functions/api/guest-log.js';
let keys;
let env;
beforeAll(async () => {
  keys = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  env = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', client_email: 'logger@example.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64')}\n-----END PRIVATE KEY-----` }), GOOGLE_SHEET_ID: 'destination', SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'public' };
});
afterEach(() => vi.unstubAllGlobals());
const req = (body = { reservation: '=IMPORTXML("bad")', nickname: 'spoofed' }, token = 'Bearer guest') => new Request('https://wegoinn.example/api/guest-log', { method: 'POST', headers: { Authorization: token }, body: JSON.stringify(body) });
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
const profile = () => reply([{ id: 'profile-id', nickname: 'Verified Guest', check_in: '2026-10-13', check_out: '2026-10-25', room_number: '701', room_type: 'Single', capacity: 1, role: 'guest' }]);
function mocks(hasTab = false) {
  const responses = [profile(), reply({ access_token: 'google-token' }), reply({ sheets: hasTab ? [{ properties: { title: 'Guest Log' } }] : [] })];
  if (!hasTab) responses.push(reply({ replies: [{}] }));
  responses.push(reply({ updatedCells: 6 }), reply({ updates: { updatedRows: 1 } }));
  const mock = vi.fn();
  responses.forEach(response => mock.mockResolvedValueOnce(response));
  vi.stubGlobal('fetch', mock);
  return mock;
}
describe('service account guest log', () => {
  it('reports missing settings without exposing credentials', async () => {
    const response = await onRequest({ request: new Request('https://wegoinn.example/api/guest-log'), env: {} });
    const result = await response.json();
    expect(result.configured).toBe(false);
    expect(result.missing).toContain('GOOGLE_SERVICE_ACCOUNT_JSON');
    expect((await onRequest({ request: req(), env: {} })).status).toBe(503);
  });
  it('rejects unauthenticated and unregistered requests before Google calls', async () => {
    const mock = vi.fn().mockResolvedValueOnce(reply([]));
    vi.stubGlobal('fetch', mock);
    expect((await onRequest({ request: req({}, ''), env })).status).toBe(401);
    expect(mock).not.toHaveBeenCalled();
    expect((await onRequest({ request: req(), env })).status).toBe(403);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('signs a valid JWT, creates the tab and appends verified, formula-safe data', async () => {
    const mock = mocks();
    expect(await (await onRequest({ request: req(), env })).json()).toEqual({ ok: true });
    const assertion = mock.mock.calls[1][1].body.get('assertion');
    const [header, claims, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({ iss: 'logger@example.iam.gserviceaccount.com', aud: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/spreadsheets' });
    expect(await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5', keys.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${claims}`))).toBe(true);
    expect(mock.mock.calls[3][0]).toContain(':batchUpdate');
    const [url, options] = mock.mock.calls.at(-1);
    expect(url).toContain('/destination/values/');
    expect(url).toContain('valueInputOption=USER_ENTERED');
    expect(JSON.parse(options.body).values[0].slice(1)).toEqual(["'", "'Verified Guest", '', "'", "'profile-id", "'2026-10-13", "'2026-10-25", "'701", "'Single", 1, "'손님"]);
  });
  it('uses an existing tab without creating another', async () => {
    const mock = mocks(true);
    expect((await onRequest({ request: req(), env })).status).toBe(200);
    expect(mock.mock.calls.some(([url]) => url.includes(':batchUpdate'))).toBe(false);
  });
  it('recovers when another request creates the tab concurrently', async () => {
    const mock = vi.fn().mockResolvedValueOnce(profile()).mockResolvedValueOnce(reply({ access_token: 'token' })).mockResolvedValueOnce(reply({ sheets: [] })).mockResolvedValueOnce(reply({ error: 'exists' }, 400)).mockResolvedValueOnce(reply({ sheets: [{ properties: { title: 'Guest Log' } }] })).mockResolvedValueOnce(reply({})).mockResolvedValueOnce(reply({ updates: { updatedRows: 1 } }));
    vi.stubGlobal('fetch', mock);
    expect((await onRequest({ request: req(), env })).status).toBe(200);
  });
  it('returns actionable permission errors without leaking provider diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(profile()).mockResolvedValueOnce(reply({ access_token: 'private-token' })).mockResolvedValueOnce(reply({ error: 'private-provider-data' }, 403)));
    const response = await onRequest({ request: req(), env });
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('share the sheet');
    expect(body).not.toContain('private-');
  });
  it('rejects malformed credentials and unsafe photo formulas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => profile()));
    expect((await onRequest({ request: req(), env: { ...env, GOOGLE_SERVICE_ACCOUNT_JSON: 'bad' } })).status).toBe(503);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply([{ id:'profile-id', avatar_url: 'https://project.supabase.co/storage/v1/object/public/photo\");BAD()' }])));
    expect((await onRequest({ request: req({ reservation: 'guest', avatarUrl: 'https://project.supabase.co/storage/v1/object/public/photo");BAD()' }), env })).status).toBe(400);
  });
});
