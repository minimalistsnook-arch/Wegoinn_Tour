import { supabase } from './supabase.js';
import { $, escapeHtml, toast, setBusy } from './utils.js';
import { moderationError } from './moderation.js';
let me;
let accounts = new Map();
let loading = false;
// Room 000 is the shared login staff use to take part as a regular guest.
const STAFF_ROOM = '000';
const roleLabel = p => p.role === 'admin' ? '운영자' : p.room_number === STAFF_ROOM ? 'Staff 직원' : '손님';
const roomLabel = p => p.room_number === STAFF_ROOM ? `${STAFF_ROOM} (Staff 직원)` : p.room_number;
export function accountSummary(id) {
 const p = accounts.get(id);
 return p ? `${p.nickname} · 객실 ${roomLabel(p) || '운영자'} · Check in ${p.check_in || '미등록'} · Check out ${p.check_out || '미등록'}` : '';
}
export function accountDetailHtml(id) {
 return `<small class="operator-account-info" data-operator-account="${escapeHtml(id || '')}" data-user-content>${escapeHtml(accountSummary(id))}</small>`;
}
export function initOperatorAccounts(profile) {
 me = profile;
 $('#accountsTab').hidden = profile.role !== 'admin';
 $('#accounts').dataset.operatorOnly = 'true';
 if (profile.role !== 'admin') return;
 $('#refreshAccounts').addEventListener('click', loadAccounts);
 $('#accountList').addEventListener('click', deleteAccount);
 document.addEventListener('section-change', event => { if (event.detail === 'accounts') loadAccounts(); });
 setInterval(() => { if (!$('#accounts').hidden && document.visibilityState !== 'hidden') loadAccounts(); }, 30000);
 return loadAccounts();
}
export async function loadAccounts() {
 if (loading || me?.role !== 'admin') return;
 loading = true;
 try {
  const { data, error } = await supabase.rpc('admin_account_roster');
  if (error) throw error;
  accounts = new Map((data || []).map(p => [p.id, p]));
  $('#accountError').hidden = true;
  document.querySelectorAll('[data-operator-account]').forEach(el => { el.textContent = accountSummary(el.dataset.operatorAccount); });
  $('#accountList').innerHTML = (data || []).map(p => `<article class="account-row">
   <strong data-user-content>${escapeHtml(p.nickname)}</strong> <span class="tag">${roleLabel(p)}${p.id === me.id ? ' · 현재 계정' : ''}</span>
   <p>${p.is_online ? '● 접속 중' : p.stay_active ? '접속 확인 안 됨' : '체크아웃 완료'} · 객실 ${escapeHtml(roomLabel(p) || '—')}</p>
   <p>Check in: ${escapeHtml(p.check_in || '미등록')}<br>Check out: ${escapeHtml(p.check_out || '미등록')}</p>
   <p>최근 활동: ${p.last_seen_at ? escapeHtml(new Date(p.last_seen_at).toLocaleString('ko-KR')) : '기록 없음'}</p>
   <button class="btn btn--soft" type="button" data-delete-account="${escapeHtml(p.id)}" ${p.id === me.id ? 'disabled' : ''}>계정 삭제</button>
  </article>`).join('') || '<p>등록된 계정이 없습니다.</p>';
 } catch (error) {
  $('#accountError').textContent = moderationError(error);
  $('#accountError').hidden = false;
 } finally { loading = false; }
}
async function deleteAccount(event) {
 const button = event.target.closest('[data-delete-account]');
 if (!button) return;
 const p = accounts.get(button.dataset.deleteAccount);
 if (!p || p.id === me.id) return;
 if (!confirm(`${p.nickname} 계정을 삭제할까요? 이 계정의 모임, 방명록, 댓글, 채팅과 해당 모임의 참가 기록·그룹 채팅도 삭제됩니다. 기존 로그인은 더 이상 사용할 수 없습니다. 되돌릴 수 없습니다.`)) return;
 setBusy(button, true);
 try {
  const { error } = await supabase.rpc('admin_delete_account', { p_profile_id: p.id });
  if (error) throw error;
  toast('계정을 삭제했습니다.');
  await loadAccounts();
  document.dispatchEvent(new Event('operator-account-deleted'));
 } catch (error) { toast(moderationError(error), 'error'); }
 finally { setBusy(button, false); }
}
export function watchSessionActivity() {
 const touch = async () => {
  if (document.visibilityState === 'hidden') return;
  try {
   const { error } = await supabase.rpc('touch_guest_session');
   if (error?.message === 'Not signed in') {
    try { localStorage.setItem('wegoinn-logout-reason', '계정이 삭제되었거나 숙박 기간이 종료되어 로그아웃되었습니다.'); } catch { /* private mode */ }
    await supabase.auth.signOut({ scope: 'local' });
   }
  } catch { /* Retry on the next heartbeat after a connection failure. */ }
 };
 touch();
 setInterval(touch, 30000);
 document.addEventListener('visibilitychange', touch);
}
