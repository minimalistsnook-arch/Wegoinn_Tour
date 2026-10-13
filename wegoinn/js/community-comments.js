import { supabase } from './supabase.js';
import { escapeHtml, avatarHtml, formatDateTime, toast, setBusy } from './utils.js';
import { icon } from './icons.js';
import { openContentEditor, moderationError } from './moderation.js';

export async function mountCommunityComments(root, community, me) {
  if (!root?.isConnected) return;
  const canWrite = me.role === 'admin' || community.creator_id === me.id;
  let rows = [];
  async function load() {
    try {
      const { data, error } = await supabase.from('community_comments')
        .select('id, content, author_id, is_operator, created_at, author:profiles(nickname, avatar_url)')
        .eq('community_id', community.id).order('created_at');
      if (!root.isConnected) return;
      if (error) {
        root.innerHTML = `<p class="muted">${escapeHtml(moderationError(error))}</p>`;
        return;
      }
      rows = data || [];
      root.innerHTML = `<h3>Comments</h3>
        ${rows.map(row => `<div class="comment" data-community-comment="${escapeHtml(row.id)}">
          ${avatarHtml(row.author?.nickname || 'Guest', 'avatar--sm', row.author?.avatar_url)}
          <div class="comment__bubble"><div class="comment__head"><strong>${escapeHtml(row.author?.nickname || 'Guest')}${row.is_operator ? ' <span class="tag">운영자</span>' : ''}</strong><time>${escapeHtml(formatDateTime(row.created_at))}</time></div>
          <p class="comment__text" data-user-content>${escapeHtml(row.content)}</p>
          <div class="comment__actions">${me.role === 'admin' ? '<button type="button" class="link-btn" data-edit-community-comment>Edit comment</button>' : ''}
          ${row.author_id === me.id || me.role === 'admin' ? '<button type="button" class="link-btn link-btn--danger" data-delete-community-comment>Delete</button>' : ''}</div></div></div>`).join('') || '<p class="comments__empty">No comments yet — say hello ✨</p>'}
        ${canWrite ? `<form class="comment-form"><input name="content" maxlength="500" placeholder="Write a comment…" aria-label="Write a comment…" required /><button type="submit" class="send-btn" aria-label="Send">${icon('send')}</button></form>` : ''}`;
    } catch (error) {
      if (root.isConnected) root.innerHTML = `<p class="muted">${escapeHtml(moderationError(error))}</p>`;
    }
  }
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-edit-community-comment], [data-delete-community-comment]');
    if (!button) return;
    const row = rows.find(r => r.id === button.closest('[data-community-comment]').dataset.communityComment);
    if (!row) return;
    if (button.hasAttribute('data-edit-community-comment')) return openContentEditor({ me, kind: 'community_comment', item: row, onSaved: load });
    if (!confirm('Delete this comment?')) return;
    setBusy(button, true);
    try {
      const { data, error } = await supabase.from('community_comments').delete().eq('id', row.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('You do not have permission to delete this comment.');
      await load();
    } catch (error) { toast(moderationError(error), 'error'); }
    finally { setBusy(button, false); }
  });
  root.addEventListener('submit', async event => {
    const form = event.target.closest('.comment-form');
    if (!form) return;
    event.preventDefault();
    const content = form.elements.content.value.trim();
    const button = form.querySelector('[type=submit]');
    if (!content || button.disabled) return;
    setBusy(button, true);
    try {
      const { error } = await supabase.from('community_comments').insert({ community_id: community.id, content });
      if (error) throw error;
      await load();
    } catch (error) { toast(moderationError(error), 'error'); }
    finally { setBusy(button, false); }
  });
  await load();
}
