// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { onRequest } from '../../functions/api/stay-status.js';
let env;
beforeAll(async () => {
  const keys = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  env = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', client_email: 'logger@example.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64')}\n-----END PRIVATE KEY-----` }), GOOGLE_SHEET_ID: 'destination', SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'public' };
});
afterEach(() => vi.unstubAllGlobals());
const req = (token = 'Bearer guest') => new Request('https://wegoinn.example/api/stay-status', { method: 'POST', headers: { Authorization: token } });
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
const me = (extra = {}) => reply([{ id: 'profile-id', nickname: 'Guest', role: 'guest', ...extra }]);
const stub = (...responses) => { const mock = vi.fn(); responses.forEach(r => mock.mockResolvedValueOnce(r)); vi.stubGlobal('fetch', mock); return mock; };

describe('stay status', () => {
  it('requires a signed-in guest', async () => {
    expect((await onRequest({ request: req(''), env })).status).toBe(401);
  });
  it('reports an ended stay when the database no longer returns the profile', async () => {
    stub(reply([]));
    expect(await (await onRequest({ request: req(), env })).json()).toEqual({ active: false, reason: 'checked_out' });
  });
  it('ends the stay when the guest row is marked "x" in column M', async () => {
    const fetch = stub(me(), reply({ access_token: 'google-token' }), reply({ values: [['other-id', '', '', '', '', '', '', 'x'], ['profile-id', '', '', '', '', '', '', ' X ']] }), new Response(null, { status: 204 }));
    expect(await (await onRequest({ request: req(), env })).json()).toEqual({ active: false, reason: 'sheet' });
    expect(fetch.mock.calls[2][0]).toContain(encodeURIComponent("'Guest Log'!F2:M"));
    expect(fetch.mock.calls[3][0]).toBe('https://project.supabase.co/rest/v1/rpc/end_my_stay');
    expect(fetch.mock.calls[3][1].headers.authorization).toBe('Bearer guest');
  });
  it('keeps the stay when only other guests are marked', async () => {
    const fetch = stub(me(), reply({ access_token: 'google-token' }), reply({ values: [['other-id', '', '', '', '', '', '', 'x'], ['profile-id']] }));
    expect(await (await onRequest({ request: req(), env })).json()).toEqual({ active: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('never locks guests out when the sheet is unreachable', async () => {
    stub(me(), reply({ access_token: 'google-token' }), reply({ error: 'nope' }, 403));
    expect((await (await onRequest({ request: req(), env })).json()).active).toBe(true);
  });
  it('skips the sheet for operators', async () => {
    const fetch = stub(me({ role: 'admin' }));
    expect(await (await onRequest({ request: req(), env })).json()).toEqual({ active: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
