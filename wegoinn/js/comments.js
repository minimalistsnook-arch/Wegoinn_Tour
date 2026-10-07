import { supabase, errorMessage } from "./supabase.js";
import { escapeHtml, avatarHtml, formatDateTime, toast } from "./utils.js";
import { detectLanguage, translationToggleHtml } from "./translation.js";
import { icon } from "./icons.js";

// POST → COMMENT → REPLY. Replies are never nested further (also enforced by a DB trigger).

function canDelete(item, me) {
  return me && (item.author_id === me.id || me.role === "admin");
}

function commentHtml(comment, me, { isReply }) {
  const name = comment.author?.nickname ?? "Guest";
  return `
    <div class="comment ${isReply ? "comment--reply" : ""}" data-comment-id="${comment.id}">
      ${avatarHtml(name, "avatar--sm")}
      <div class="comment__bubble">
        <div class="comment__head">
          <strong>${escapeHtml(name)}</strong>
          <time datetime="${comment.created_at}">${escapeHtml(formatDateTime(comment.created_at))}</time>
        </div>
        <div class="translatable">
          <p class="comment__text js-text" data-original="${escapeHtml(comment.content)}">${escapeHtml(comment.content)}</p>
        </div>
        <div class="comment__actions">
          ${translationToggleHtml()}
          ${isReply ? "" : `<button type="button" class="link-btn" data-action="reply" data-comment-id="${comment.id}">${icon("reply")} Reply</button>`}
          ${canDelete(comment, me) ? `<button type="button" class="link-btn link-btn--danger" data-action="delete-comment" data-comment-id="${comment.id}">Delete</button>` : ""}
        </div>
      </div>
    </div>`;
}

function commentFormHtml(postId, parent = null) {
  const placeholder = parent ? `Reply to ${parent.author?.nickname ?? "guest"}…` : "Write a comment…";
  return `
    <form class="comment-form ${parent ? "comment-form--reply" : ""}" data-post-id="${postId}" ${parent ? `data-parent-id="${parent.id}"` : ""}>
      <input type="text" name="content" maxlength="500" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" autocomplete="off" required />
      ${parent ? `<button type="button" class="link-btn" data-action="cancel-reply">Cancel</button>` : ""}
      <button type="submit" class="send-btn" aria-label="Send">${icon("send")}</button>
    </form>`;
}

export function commentsSectionHtml(post, me, replyingTo) {
  const all = [...(post.comments || [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const top = all.filter((c) => !c.parent_comment_id);

  const thread = top.map((comment) => {
    const replies = all.filter((c) => c.parent_comment_id === comment.id);
    return `
      <div class="thread">
        ${commentHtml(comment, me, { isReply: false })}
        ${replies.map((r) => commentHtml(r, me, { isReply: true })).join("")}
        ${replyingTo === comment.id ? commentFormHtml(post.id, comment) : ""}
      </div>`;
  }).join("");

  return `
    <section class="comments" aria-label="Comments">
      ${thread || `<p class="comments__empty">No comments yet — say hello ✨</p>`}
      ${commentFormHtml(post.id)}
    </section>`;
}

export async function addComment({ postId, parentId, content }) {
  const text = content.trim();
  if (!text) return false;
  const { error } = await supabase.from("comments").insert({
    post_id: postId,
    parent_comment_id: parentId || null,
    content: text,
    original_language: detectLanguage(text),
  });
  if (error) {
    toast(errorMessage(error), "error");
    return false;
  }
  return true;
}

export async function deleteComment(commentId) {
  // RLS decides: own comment, or admin. Replies are removed with their parent.
  const { data, error } = await supabase.from("comments").delete().eq("id", commentId).select("id");
  if (error || !data?.length) {
    toast(error ? errorMessage(error) : "You can only delete your own comments.", "error");
    return false;
  }
  return true;
}
