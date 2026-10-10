import { openCommunityById } from "./community.js";
import { supabase, errorMessage } from './supabase.js';
import { $, escapeHtml, formatDateTime, toast } from './utils.js';
import { openSheet } from './sheet.js';
let rows = [];
const labels = { application: 'New application', approved: 'Application approved', declined: 'Application declined', withdrawn: 'Application withdrawn', updated: 'Community updated', cancelled: 'Community cancelled' };
export async function refreshNotifications() {
  const { data, error } = await supabase.from('notifications').select('id, kind, community_id, community_title, created_at, read_at').order('created_at', { ascending: false }).limit(100);
  if (error) {
    $('#notificationList').textContent = errorMessage(error, 'Notifications could not be loaded.');
    $('#notificationCount').textContent = '—';
    return;
  }
  rows = data;
  $('#notificationCount').textContent = String(rows.filter(n => !n.read_at).length);
  $('#notificationList').innerHTML = rows.length ? rows.map(n => `<article class="notification ${n.read_at ? '' : 'notification--unread'}"><b>${labels[n.kind] || n.kind}</b><button type="button" class="link-btn" data-notice-community="${escapeHtml(n.community_id)}"><span data-user-content>${escapeHtml(n.community_title)}</span></button><time>${escapeHtml(formatDateTime(n.created_at))}</time></article>`).join('') : '<p>No notifications yet.</p>';
}
export function initNotifications() {
  $("#notificationList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-notice-community]");
    if (button) openCommunityById(button.dataset.noticeCommunity);
  });
  $('#notificationBtn').addEventListener('click', () => { refreshNotifications(); openSheet('notificationSheet'); });
  $('#markNotificationsRead').addEventListener('click', async () => {
    const ids = rows.filter(n => !n.read_at).map(n => n.id);
    if (!ids.length) return;
    const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids });
    if (error) return toast(errorMessage(error), 'error');
    await refreshNotifications();
  });
  // Refresh on return even if the Realtime connection was interrupted.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshNotifications(); });
  return refreshNotifications();
}
