import { supabase, errorMessage } from "./supabase.js";
import { $, escapeHtml, avatarHtml, formatDateTime, toast, setBusy, debounce } from "./utils.js";
import { compressImage, uploadImage, isImageUploadConfigured } from "./image-upload.js";
import { detectLanguage, translationToggleHtml, handleTranslationToggle } from "./translation.js";
import { commentsSectionHtml, addComment, deleteComment } from "./comments.js";
import { icon } from "./icons.js";

const FEED_LIMIT = 20;

const POST_COLUMNS = `
  id, content, original_language, image_url, created_at, author_id,
  author:profiles ( nickname ),
  comments ( id, post_id, parent_comment_id, content, original_language, created_at, author_id,
             author:profiles ( nickname ) )`;

const state = {
  me: null,
  visibleLimit: FEED_LIMIT,
  loading: false,
  posts: [],
  openComments: new Set(),
  replyingTo: null,        // top-level comment id currently being replied to
  draftImage: null,        // compressed File — the original is never kept
  draftPreviewUrl: "",
  refreshPending: false,
  publishing: false,
  imageLoading: false,
};

const els = {};

export function initGuestbook(me) {
  state.me = me;
  Object.assign(els, {
    feed: $("#feed"),
    count: $("#postCount"),
    input: $("#postInput"),
    counter: $("#postCounter"),
    fileInput: $("#postImageInput"),
    preview: $("#postPreview"),
    previewImg: $("#postPreviewImg"),
    removeImage: $("#removePostImage"),
    publish: $("#publishPostBtn"),
    composerAvatar: $("#composerAvatar"),
  });

  els.composerAvatar.outerHTML = avatarHtml(me.nickname, "avatar--md");
  els.input.addEventListener("input", updateComposer);
  // Enter posts straight to the guestbook; Shift+Enter adds a new line.
  els.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!els.publish.disabled) publishPost();
    }
  });
  els.fileInput.addEventListener("change", onPickImage);
  els.removeImage.addEventListener("click", clearDraftImage);
  els.publish.addEventListener("click", publishPost);
  els.feed.addEventListener("click", onFeedClick);
  els.feed.addEventListener("submit", onFeedSubmit);
  // Realtime refreshes wait while the guest is typing in the feed.
  els.feed.addEventListener("focusout", () => {
    if (state.refreshPending) setTimeout(() => !isTypingInFeed() && loadFeed(), 50);
  });

  $("#loadMorePosts").addEventListener("click", async () => {
    if (state.loading) return;
    state.visibleLimit += FEED_LIMIT;
    await loadFeed();
  });
  setupComposerDock();
  updateComposer();
  return loadFeed();
}

/* ---------------- Composer ---------------- */

function setupComposerDock() {
  const section = $("#guestbook");
  const composer = $("#guestbookComposer");
  const syncDock = () => {
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0;
    const height = viewport?.height || window.innerHeight;
    const rect = section.getBoundingClientRect();
    const focused = composer.contains(document.activeElement);
    const visible = focused || (rect.top <= top + height * 0.55 && rect.bottom > top + height * 0.55);
    composer.classList.toggle("is-visible", visible);
    composer.inert = !visible;
    section.style.setProperty("--guestbook-composer-height", `${composer.getBoundingClientRect().height}px`);
    composer.style.setProperty("--guestbook-keyboard-offset", `${Math.max(0, window.innerHeight - height - top)}px`);
  };
  window.addEventListener("scroll", syncDock, { passive: true });
  window.addEventListener("resize", syncDock);
  window.visualViewport?.addEventListener("resize", syncDock);
  window.visualViewport?.addEventListener("scroll", syncDock);
  composer.addEventListener("focusin", syncDock);
  composer.addEventListener("focusout", () => requestAnimationFrame(syncDock));
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(syncDock).observe(composer);
  syncDock();
}

function updateComposer() {
  const len = els.input.value.length;
  els.counter.textContent = `${len} / 1000`;
  els.input.style.height = "auto";
  els.input.style.height = `${els.input.scrollHeight}px`;
  els.publish.disabled = state.publishing || state.imageLoading || (!els.input.value.trim() && !state.draftImage);
  els.input.readOnly = state.publishing;
  els.fileInput.disabled = state.publishing || state.imageLoading;
  els.removeImage.disabled = state.publishing || state.imageLoading;
}

async function onPickImage() {
  if (state.publishing || state.imageLoading) return;
  const file = els.fileInput.files?.[0];
  els.fileInput.value = "";
  if (!file) return;
  if (!isImageUploadConfigured()) {
    toast("Photo upload isn't connected yet. You can post text for now.");
    return;
  }
  state.imageLoading = true;
  updateComposer();
  try {
    els.preview.classList.add("is-loading");
    els.preview.hidden = false;
    const compressed = await compressImage(file);
    clearDraftImage();
    state.draftImage = compressed;
    state.draftPreviewUrl = URL.createObjectURL(compressed);
    els.previewImg.src = state.draftPreviewUrl;
    els.preview.hidden = false;
  } catch (err) {
    clearDraftImage();
    toast(err.message, "error");
  } finally {
    state.imageLoading = false;
    els.preview.classList.remove("is-loading");
    updateComposer();
  }
}

function clearDraftImage() {
  if (state.draftPreviewUrl) URL.revokeObjectURL(state.draftPreviewUrl);
  state.draftImage = null;
  state.draftPreviewUrl = "";
  els.previewImg.removeAttribute("src");
  els.preview.hidden = true;
  updateComposer();
}

async function publishPost() {
  if (state.publishing || state.imageLoading) return;
  const content = els.input.value.trim();
  if (!content && !state.draftImage) return toast("Write something or add a photo first.");

  state.publishing = true;
  updateComposer();
  setBusy(els.publish, true, "Posting…");
  try {
    let imageUrl = null;
    if (state.draftImage) imageUrl = await uploadImage(state.draftImage);

    const { error } = await supabase.from("posts").insert({
      content,
      original_language: detectLanguage(content),
      image_url: imageUrl,
    });
    if (error) throw error;

    els.input.value = "";
    clearDraftImage();
    toast("Your moment is on the wall ✨");
    await loadFeed();
    els.feed.querySelector(".post")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  } catch (err) {
    toast(errorMessage(err), "error");
  } finally {
    state.publishing = false;
    setBusy(els.publish, false);
    updateComposer();
  }
}

/* ---------------- Feed ---------------- */

export async function loadFeed() {
  if (state.loading) { state.refreshPending = true; return; }
  state.loading = true;
  state.refreshPending = false;
  const more = $("#loadMorePosts");
  more.disabled = true;
  let result;
  try { result = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(state.visibleLimit + 1);
  } catch (err) { result = { error: err }; }
  finally { state.loading = false; more.disabled = false; }
  const { data, error } = result;

  if (error) {
    els.feed.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error, "Couldn't load the guestbook."))}</div>`;
    return;
  }
  more.hidden = data.length <= state.visibleLimit;
  state.posts = data.slice(0, state.visibleLimit);
  renderFeed();
  if (state.refreshPending) scheduleFeedRefresh();
}

function isTypingInFeed() {
  const a = document.activeElement;
  return a && els.feed.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && a.value;
}

const refreshSoon = debounce(() => {
  if (isTypingInFeed()) state.refreshPending = true;
  else loadFeed();
}, 400);

export function scheduleFeedRefresh() {
  refreshSoon();
}

function renderFeed() {
  els.count.textContent = `${state.posts.length} ${state.posts.length === 1 ? "story" : "stories"}`;
  if (!state.posts.length) {
    els.feed.innerHTML = `
      <div class="empty-state">
        ${icon("pen")}
        <strong>The guestbook is waiting for you</strong>
        <p>Be the first to leave a little note for the next traveler.</p>
      </div>`;
    return;
  }
  els.feed.innerHTML = state.posts.map(postHtml).join("");
}

function postHtml(post) {
  const me = state.me;
  const name = post.author?.nickname ?? "Guest";
  const canDelete = post.author_id === me.id || me.role === "admin";
  const commentCount = post.comments?.length ?? 0;
  const open = state.openComments.has(post.id);

  return `
    <article class="post card" data-post-id="${post.id}">
      <header class="post__head">
        ${avatarHtml(name, "avatar--md")}
        <div class="post__who">
          <strong>${escapeHtml(name)}${post.author_id === me.id ? ` <span class="you-tag">you</span>` : ""}</strong>
          <time datetime="${post.created_at}">${escapeHtml(formatDateTime(post.created_at))}</time>
        </div>
        ${canDelete ? `<button type="button" class="icon-btn icon-btn--quiet" data-action="delete-post" aria-label="Delete post">${icon("trash")}</button>` : ""}
      </header>

      ${post.content ? `
        <div class="translatable">
          <p class="post__text js-text" data-original="${escapeHtml(post.content)}">${escapeHtml(post.content)}</p>
        </div>` : ""}

      ${post.image_url ? `
        <figure class="post__photo">
          <img src="${escapeHtml(post.image_url)}" alt="Photo shared by ${escapeHtml(name)}" loading="lazy" decoding="async" />
        </figure>` : ""}

      <footer class="post__foot">
        ${post.content ? translationToggleHtml() : "<span></span>"}
        <button type="button" class="pill-btn ${open ? "is-active" : ""}" data-action="toggle-comments" aria-expanded="${open}">
          ${icon("chat")} ${commentCount} ${commentCount === 1 ? "comment" : "comments"}
        </button>
      </footer>

      ${open ? commentsSectionHtml(post, me, state.replyingTo) : ""}
    </article>`;
}

function rerenderPost(postId, focusSelector) {
  const post = state.posts.find((p) => p.id === postId);
  const el = els.feed.querySelector(`[data-post-id="${postId}"]`);
  if (!post || !el) return;
  el.outerHTML = postHtml(post);
  if (focusSelector) els.feed.querySelector(`[data-post-id="${postId}"] ${focusSelector}`)?.focus();
}

async function onFeedClick(event) {
  const target = event.target.closest("button");
  if (!target) return;
  const postEl = target.closest("[data-post-id]");
  const postId = postEl?.dataset.postId;

  if (target.dataset.langMode) {
    const textEl = target.closest(".translatable, .comment__bubble, .post")?.querySelector(".js-text");
    if (textEl) handleTranslationToggle(target, textEl, (msg) => toast(msg || "Translation isn't connected yet — showing the original."));
    return;
  }

  switch (target.dataset.action) {
    case "toggle-comments":
      state.openComments.has(postId) ? state.openComments.delete(postId) : state.openComments.add(postId);
      state.replyingTo = null;
      rerenderPost(postId);
      break;

    case "reply":
      state.replyingTo = target.dataset.commentId;
      rerenderPost(postId, ".comment-form--reply input");
      break;

    case "cancel-reply":
      state.replyingTo = null;
      rerenderPost(postId);
      break;

    case "delete-comment":
      if (!confirm("Delete this comment? Replies to it will be removed too.")) return;
      if (await deleteComment(target.dataset.commentId)) {
        toast("Comment deleted.");
        loadFeed();
      }
      break;

    case "delete-post": {
      if (!confirm("Delete this post?")) return;
      // RLS only lets the author (or an admin) delete — an empty result means "not allowed".
      const { data, error } = await supabase.from("posts").delete().eq("id", postId).select("id");
      if (error || !data?.length) return toast(error ? errorMessage(error) : "You can only delete your own posts.", "error");
      toast("Post deleted.");
      loadFeed();
      break;
    }
  }
}

async function onFeedSubmit(event) {
  const form = event.target.closest(".comment-form");
  if (!form) return;
  event.preventDefault();
  const input = form.elements.content;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  const ok = await addComment({
    postId: form.dataset.postId,
    parentId: form.dataset.parentId,
    content: input.value,
  });
  button.disabled = false;
  if (!ok) return;
  input.value = "";
  state.replyingTo = null;
  state.openComments.add(form.dataset.postId);
  await loadFeed();
}
