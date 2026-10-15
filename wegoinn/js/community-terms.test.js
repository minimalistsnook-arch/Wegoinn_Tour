import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn(), signOut: vi.fn() }));
vi.mock('./supabase.js', () => ({ supabase: { rpc: mock.rpc, auth: { signOut: mock.signOut } } }));
import { ensureCommunityConsent, renderTerms, renderTermsSettings } from './community-terms.js';
const body = '# Welcome!\n\n### 이용 안내\n\n**안내** <script>alert(1)</script>\n\n- 연락처\n\n---\n\n감사합니다.';
const terms = { version: 1, body, accepted: false };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
 document.body.innerHTML = '<div id="appView"></div><div id="settings"></div>';
 mock.rpc.mockReset(); mock.signOut.mockReset();
 HTMLDialogElement.prototype.showModal = function () { this.open = true; };
 HTMLDialogElement.prototype.close = function () { this.open = false; };
 document.documentElement.classList.remove('consent-open');
});
afterEach(() => { vi.restoreAllMocks(); });
it('renders the requested headings and emphasis while escaping administrator HTML', () => {
 const html = renderTerms(body);
 expect(html).toContain('<h2>Welcome!</h2>');
 expect(html).toContain('<strong>안내</strong>');
 expect(html).not.toContain('<script>');
 expect(html).toContain('&lt;script&gt;');
});
it('blocks entry until checked and successfully saved, and cannot be dismissed with Escape', async () => {
 let accepted = false;
 mock.rpc.mockImplementation(async name => name === 'get_community_terms'
  ? { data: { ...terms, accepted }, error: null }
  : (accepted = true, { error: null }));
 let entered = false;
 const pending = ensureCommunityConsent().then(() => { entered = true; });
 await settle();
 const dialog = document.querySelector('dialog');
 const checkbox = dialog.querySelector('input');
 const button = dialog.querySelector('.terms-accept');
 expect(button.disabled).toBe(true);
 expect(document.querySelector('#appView').inert).toBe(true);
 dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
 await settle(); expect(entered).toBe(false);
 const escape = new Event('cancel', { cancelable: true }); dialog.dispatchEvent(escape);
 expect(escape.defaultPrevented).toBe(true);
 checkbox.checked = true; checkbox.dispatchEvent(new Event('change'));
 expect(button.disabled).toBe(false);
 dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
 await pending;
 expect(mock.rpc).toHaveBeenCalledWith('accept_community_terms', { p_version: 1 });
 expect(entered).toBe(true); expect(document.querySelector('dialog')).toBeNull();
 expect(document.querySelector('#appView').inert).toBe(false);
});
it('keeps users blocked after a failed save and resets their checkbox for a changed notice', async () => {
 let version = 1, accepted = false;
 mock.rpc.mockImplementation(async name => {
  if (name === 'get_community_terms') return { data: { ...terms, version, accepted } };
  if (version === 1) { version = 2; return { error: { message: '안내 내용이 변경되었습니다.' } }; }
  accepted = true; return { error: null };
 });
 const pending = ensureCommunityConsent(); await settle();
 const dialog = document.querySelector('dialog'), checkbox = dialog.querySelector('input');
 const submit = () => { checkbox.checked = true; checkbox.dispatchEvent(new Event('change')); dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true })); };
 submit(); await settle(); await settle();
 expect(dialog.open).toBe(true); expect(checkbox.checked).toBe(false);
 expect(dialog.querySelector('.community-consent__version').textContent).toContain('2');
 submit(); await pending;
 expect(mock.rpc).toHaveBeenCalledWith('accept_community_terms', { p_version: 2 });
});
it('does not repeat an already accepted notice', async () => {
 mock.rpc.mockResolvedValue({ data: { ...terms, accepted: true } });
 await ensureCommunityConsent(); expect(document.querySelector('dialog')).toBeNull();
});
it('blocks on fetch failure and supports retry before agreement', async () => {
 mock.rpc.mockResolvedValueOnce({ error: { message: 'offline' } }).mockResolvedValueOnce({ data: terms });
 const pending = ensureCommunityConsent(); await settle();
 const dialog = document.querySelector('dialog');
 expect(dialog.querySelector('.terms-accept').disabled).toBe(true);
 dialog.querySelector('.terms-retry').click(); await settle();
 mock.rpc.mockImplementation(async name => name === 'get_community_terms' ? { data: { ...terms, accepted: true } } : { error: null });
 const checkbox = dialog.querySelector('input'); checkbox.checked = true; checkbox.dispatchEvent(new Event('change'));
 dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true })); await pending;
});
it('edits settings safely and sends the expected version to avoid overwriting another operator', async () => {
 mock.rpc.mockResolvedValueOnce({ data: terms }).mockResolvedValueOnce({ data: 2 });
 const container = document.querySelector('#settings'); await renderTermsSettings(container);
 const input = container.querySelector('textarea'); input.value = 'Updated guidance. '.repeat(10);
 const form = container.querySelector('form'); form.dispatchEvent(new Event('submit', { cancelable: true })); await settle();
 expect(mock.rpc).toHaveBeenCalledWith('publish_community_terms', { p_body: input.value, p_expected_version: 1 });
 expect(container.querySelector('[role=status]').textContent).toContain('v2');
});
