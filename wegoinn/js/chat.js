// Live chat — the "Chat" section of the page. Global Chat for every guest, plus a group chat per community
// (host + approved members; the database decides who may read or write).
// Messages are stored in chat_messages and pushed through Supabase Realtime;
// "online now" uses Realtime Presence.
import { supabase, errorMessage } from "./supabase.js";
import { $, escapeHtml, avatarHtml, formatDate, formatTime, formatDateKey, shortTime, toast, setBusy, communityIsLocked } from "./utils.js";
import { detectLanguage } from "./translation.js";
import { closeSheet } from "./sheet.js";
import { icon } from "./icons.js";
import { openContentEditor, moderationError } from "./moderation.js";

const HISTORY_LIMIT = 100;
const CHAT_COLUMNS = "id, community_id, author_id, content, created_at, author:profiles ( nickname, avatar_url )";

const state = {
  me: null,
  room: null,          // null = Global Chat, otherwise { id, title }
  visible: false,      // is the Chat section on screen?
  hasEarlier: false,
  earlierBusy: false,
  messages: new Map(),
  replyTo: null,
  ids: new Set(),      // message ids currently rendered
  lastDay: "",
  unread: 0,
  nicknames: new Map(),
  avatars: new Map(),
  loading: false,      // history for the open room is being fetched
  pending: [],         // realtime rows that arrived while history was loading
  lastAt: null,        // created_at of the newest rendered message (for resync)
  channel: null,
  rooms: [],           // community group chats this guest hosts or joined: { id, title, date, time }
  unreadRooms: new Set(), // room ids ("" = Global Chat) with messages the guest hasn't opened yet
};

const els = {};

export function initChat(me) {
  state.me = me;
  state.nicknames.set(me.id, me.nickname);
  state.avatars.set(me.id, me.avatar_url);
  Object.assign(els, {
    section: $("#chat"),
    back: $("#chatBackBtn"),
    unread: $("#chatUnread"),
    eyebrow: $("#chatEyebrow"),
    title: $("#chatTitle"),
    onlineWrap: $("#chatOnlineWrap"),
    online: $("#chatOnline"),
    list: $("#chatMessages"),
    form: $("#chatForm"),
    input: $("#chatInput"),
    send: $("#chatSend"),
    closeFullscreen: $("#chatCloseFullscreen"),
    rooms: $("#chatRooms"),
    earlier: $("#chatLoadEarlier"),
  });
  els.rooms.addEventListener("click", (event) => {
    const button = event.target.closest("[data-room]");
    if (!button) return;
    const room = state.rooms.find((r) => r.id === button.dataset.room) || null;
    if ((room?.id ?? null) !== (state.room?.id ?? null)) openChat(room);
  });

  els.earlier.addEventListener("click", loadEarlierMessages);
  $("#chatCancelReply").addEventListener("click", clearReply);
  els.back.addEventListener("click", () => openChat());
  els.form.addEventListener("submit", sendMessage);
  els.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      els.form.requestSubmit();
    }
  });
  els.input.addEventListener("input", onInput);
  setupMobileChat();
  els.list.addEventListener("click", onListClick);
  trackPresence();
  subscribeChat();
  // Back online / back to the tab: catch up on anything the socket missed.
  window.addEventListener("online", syncMissed);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && syncMissed());
  watchVisibility();
  showRoom(null);
  return loadMessages();
}

// Keep the chat inside the visible viewport when a phone keyboard opens.
function setupMobileChat() {
  const mobile = window.matchMedia("(max-width: 600px)");
  let expanded = false;
  const syncViewport = () => {
    if (!expanded) return;
    if (!mobile.matches) { closeFullscreen(); return; }
    const stick = nearBottom();
    const viewport = window.visualViewport;
    els.section.style.setProperty("--chat-viewport-top", `${viewport?.offsetTop || 0}px`);
    els.section.style.setProperty("--chat-viewport-height", `${viewport?.height || window.innerHeight}px`);
    scrollToEnd(stick);
  };
  const closeFullscreen = () => {
    if (!expanded) return;
    expanded = false;
    els.input.blur();
    els.section.classList.remove("is-fullscreen");
    document.documentElement.classList.remove("chat-fullscreen");
    els.closeFullscreen.hidden = true;
    els.section.style.removeProperty("--chat-viewport-top");
    els.section.style.removeProperty("--chat-viewport-height");
  };
  els.input.addEventListener("focus", () => {
    if (!mobile.matches || expanded) return;
    expanded = true;
    els.section.classList.add("is-fullscreen");
    document.documentElement.classList.add("chat-fullscreen");
    els.closeFullscreen.hidden = false;
    state.visible = true;
    setUnread(0);
    syncViewport();
    scrollToEnd(true);
  });
  els.closeFullscreen.addEventListener("click", closeFullscreen);
  document.addEventListener("keydown", (event) => {
    if (expanded && event.key === "Escape") closeFullscreen();
  });
  window.addEventListener("resize", syncViewport);
  window.visualViewport?.addEventListener("resize", syncViewport);
  window.visualViewport?.addEventListener("scroll", syncViewport);
}

// Global messages that arrive while the Chat section is off screen count as unread.
function watchVisibility() {
  if (typeof IntersectionObserver === "undefined") return;
  new IntersectionObserver(([entry]) => {
    state.visible = entry.isIntersecting;
    if (state.visible) setUnread(0);
  }, { threshold: 0.25 }).observe(els.section);
}

function onInput() {
  els.send.disabled = !els.input.value.trim();
  els.input.style.height = "auto";
  els.input.style.height = `${els.input.scrollHeight}px`;
}

/** Switches the Chat section to Global Chat, or to a community's group chat when `room` = { id, title }. */
export async function openChat(room = null) {
  document.querySelectorAll(".sheet.is-open").forEach((sheet) => closeSheet(sheet.id));
  showRoom(room);
  if (location.hash !== "#chat") location.hash = "chat"; // switch to the Chat page
  await loadMessages();
  els.input.focus({ preventScroll: true });
}

/** Sets the community chats listed under Live Chat (called whenever "My communities" reloads). */
export function setChatRooms(rooms) {
  const upcoming = (r) => !communityIsLocked({ community_date: r.date, community_time: r.time, status: "active" });
  const key = (r) => `${r.date}T${r.time}`;
  // Upcoming first (soonest on top), then past ones (most recent first).
  state.rooms = [...rooms].sort((a, b) => (upcoming(b) - upcoming(a)) || (upcoming(a) ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a))));
  renderRooms();
}

function renderRooms() {
  if (!els.rooms) return;
  const current = state.room?.id ?? "";
  const chip = (id, label, sub = "") => `
    <button type="button" class="chat-room ${id === current ? "is-active" : ""}" data-room="${escapeHtml(id)}" aria-pressed="${id === current}">
      ${label}${sub ? `<small>${escapeHtml(sub)}</small>` : ""}${state.unreadRooms.has(id) ? `<i class="chat-room__dot" aria-label="New messages"></i>` : ""}
    </button>`;
  els.rooms.innerHTML = chip("", `${icon("globe")} <span>Global Chat</span>`) + state.rooms.map((r) =>
    chip(r.id, `${icon("users")} <span data-user-content>${escapeHtml(r.title)}</span>`, `${formatDateKey(r.date, { month: "short", day: "numeric" })} ${shortTime(r.time)}`)).join("");
  els.rooms.hidden = false;
}

function showRoom(room) {
  clearReply();
  state.room = room;
  state.unreadRooms.delete(room?.id ?? "");
  renderRooms();
  if (!room) setUnread(0);
  els.eyebrow.textContent = room ? "Group chat" : "Everyone at Wegoinn";
  els.title.textContent = room ? room.title : "Global Chat";
  // Reset the site translator's memory of the previous room's title.
  delete els.title.dataset.siteOriginal;
  delete els.title.dataset.siteTranslated;
  els.title.toggleAttribute("data-user-content", Boolean(room));
  els.back.hidden = !room;
  els.send.disabled = !els.input.value.trim();
}

async function loadMessages() {
  const room = state.room;
  state.loading = true;
  state.pending = [];
  els.list.innerHTML = `<span class="loader"></span>`;
  els.earlier.hidden = true;
  let query = supabase.from("chat_messages").select(CHAT_COLUMNS);
  query = state.room ? query.eq("community_id", state.room.id) : query.is("community_id", null);
  const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(HISTORY_LIMIT);
  if (room !== state.room) return; // the guest switched rooms while this was loading
  state.loading = false;
  if (error) {
    els.list.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error, "Messages could not be loaded."))}</div>`;
    return;
  }
  state.hasEarlier = data.length === HISTORY_LIMIT;
  els.earlier.hidden = state.me.role !== "admin" || !state.hasEarlier;
  state.ids.clear();
  state.messages.clear();
  state.lastDay = "";
  state.lastAt = null;
  els.list.innerHTML = "";
  if (!data.length) els.list.innerHTML = `<p class="chat-empty">No messages yet — say hello 👋</p>`;
  data.reverse().forEach(appendMessage);
  // Messages that arrived over realtime while the history was loading.
  state.pending.filter(inCurrentRoom).forEach(appendMessage);
  state.pending = [];
  scrollToEnd(true);
}

// Operators can also moderate messages older than the initial 100-message window.
async function loadEarlierMessages() {
  if (state.me.role !== "admin" || state.earlierBusy || !state.hasEarlier) return;
  const room = state.room;
  const ordered = [...state.messages.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const oldest = ordered[0];
  if (!oldest) return;
  state.earlierBusy = true;
  setBusy(els.earlier, true);
  try {
    let query = supabase.from("chat_messages").select(CHAT_COLUMNS);
    query = room ? query.eq("community_id", room.id) : query.is("community_id", null);
    const { data, error } = await query.or(`created_at.lt.${oldest.created_at},and(created_at.eq.${oldest.created_at},id.lt.${oldest.id})`)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(HISTORY_LIMIT);
    if (error) throw error;
    if (room !== state.room) return;
    const height = els.list.scrollHeight, top = els.list.scrollTop;
    const rows = [...data, ...state.messages.values()].sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    state.ids.clear();state.messages.clear();state.lastDay = "";els.list.innerHTML = "";
    rows.forEach(appendMessage);
    state.hasEarlier = data.length === HISTORY_LIMIT;
    els.earlier.hidden = !state.hasEarlier;
    requestAnimationFrame(() => { els.list.scrollTop = top + els.list.scrollHeight - height; });
  } catch (error) { toast(moderationError(error), "error"); }
  finally { state.earlierBusy = false;setBusy(els.earlier, false); }
}

function inCurrentRoom(row) {
  return (row.community_id ?? null) === (state.room?.id ?? null);
}

function appendMessage(row) {
  if (state.ids.has(row.id)) return;
  state.ids.add(row.id);
  state.messages.set(row.id, row);
  if (!state.lastAt || Date.parse(row.created_at) > Date.parse(state.lastAt)) state.lastAt = row.created_at;
  const nickname = row.author?.nickname ?? state.nicknames.get(row.author_id) ?? "Guest";
  state.nicknames.set(row.author_id, nickname);
  if (row.author) state.avatars.set(row.author_id, row.author.avatar_url);
  els.list.querySelector(".chat-empty")?.remove();

  const day = formatDate(row.created_at);
  if (day !== state.lastDay) {
    state.lastDay = day;
    els.list.insertAdjacentHTML("beforeend", `<p class="chat-day"><span>${escapeHtml(day)}</span></p>`);
  }
  els.list.insertAdjacentHTML("beforeend", messageHtml(row));
}

function messageHtml(row) {
  const mine = row.author_id === state.me.id;
  const admin = state.me.role === "admin";
  const nickname = row.author?.nickname ?? state.nicknames.get(row.author_id) ?? "Guest";
  return `<article class="chat-msg ${mine ? "chat-msg--mine" : ""}" data-msg-id="${escapeHtml(row.id)}">
      ${mine ? "" : avatarHtml(nickname, "avatar--sm", state.avatars.get(row.author_id))}
      <div class="chat-msg__body">
        <div class="chat-msg__meta"><strong>${escapeHtml(mine ? "you" : nickname)}</strong><time>${escapeHtml(formatTime(row.created_at))}</time></div>
        <p class="chat-msg__text" data-user-content>${escapeHtml(row.content)}</p>
        <div class="chat-msg__actions">
          ${admin ? `<button type="button" class="link-btn" data-reply-msg="${escapeHtml(row.id)}">Reply</button><button type="button" class="link-btn" data-edit-msg="${escapeHtml(row.id)}">Edit message</button>` : ""}
          ${mine || admin ? `<button type="button" class="icon-btn icon-btn--quiet chat-msg__delete" data-delete-msg="${escapeHtml(row.id)}" aria-label="Delete message">${icon("trash")}</button>` : ""}
        </div>
      </div>
    </article>`;
}

function replyPrefix() {
  return state.replyTo ? `[운영자 답글 → ${state.replyTo.nickname}]\n“${state.replyTo.preview}”\n` : "";
}
function clearReply() {
  state.replyTo = null;
  const context = $("#chatReplyContext");
  if (context) context.hidden = true;
  if (els.input) els.input.maxLength = 500;
}
function beginReply(row) {
  state.replyTo = { id: row.id, nickname: row.author?.nickname ?? state.nicknames.get(row.author_id) ?? "Guest", preview: row.content.slice(0, 120) };
  $("#chatReplyLabel").textContent = `Reply to ${state.replyTo.nickname}: ${state.replyTo.preview}`;
  $("#chatReplyContext").hidden = false;
  els.input.maxLength = 500 - replyPrefix().length;
  els.input.focus({ preventScroll: true });
}


function nearBottom() {
  return els.list.scrollHeight - els.list.scrollTop - els.list.clientHeight < 120;
}

function scrollToEnd(force = false) {
  if (force || nearBottom()) requestAnimationFrame(() => (els.list.scrollTop = els.list.scrollHeight));
}

async function sendMessage(event) {
  event.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  const content = replyPrefix() + text;
  if (content.length > 500) return toast("답글은 인용한 내용을 포함해 500자까지 보낼 수 있습니다.", "error");
  setBusy(els.send, true, "…");
  try {
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({ community_id: state.room?.id ?? null, content, original_language: detectLanguage(content) })
      .select(CHAT_COLUMNS)
      .single();
    if (error) throw error;
    els.input.value = "";
    clearReply();
    onInput();
    if (inCurrentRoom(data)) {
      appendMessage(data);
      scrollToEnd(true);
    }
  } catch (err) {
    toast(errorMessage(err), "error");
  } finally {
    setBusy(els.send, false);
    els.send.disabled = !els.input.value.trim();
    els.input.focus({ preventScroll: true });
  }
}

async function onListClick(event) {
  const editButton = event.target.closest("[data-edit-msg], [data-reply-msg]");
  if (editButton && state.me.role === "admin") {
    const row = state.messages.get(editButton.dataset.editMsg || editButton.dataset.replyMsg);
    if (!row) return;
    if (editButton.hasAttribute("data-reply-msg")) return beginReply(row);
    return openContentEditor({ me: state.me, kind: "chat", item: row, onSaved: loadMessages });
  }
  const button = event.target.closest("[data-delete-msg]");
  if (!button || !confirm("Delete this message?")) return;
  button.disabled = true;
  const { data, error } = await supabase.from("chat_messages").delete().eq("id", button.dataset.deleteMsg).select("id");
  if (error || !data?.length) {
    button.disabled = false;
    return toast(error ? moderationError(error) : "You don't have permission to do that.", "error");
  }
  removeMessage(button.dataset.deleteMsg);
}

function removeMessage(id) {
  [...els.list.querySelectorAll("[data-msg-id]")].find((el) => el.dataset.msgId === id)?.remove();
  state.ids.delete(id);
  state.messages.delete(id);
  if (state.replyTo?.id === id) clearReply();
}

/* ---------------- Realtime ---------------- */

// Chat has its own channel so a problem with another table's subscription
// can't stop chat messages, and it starts without waiting for the rest of the page.
// RLS (chat_select) still decides which rows reach this guest; rooms are
// filtered client-side because Global Chat rows have community_id = null.
function subscribeChat() {
  const channel = supabase
    .channel("wegoinn-chat")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, onChatInsert)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages" }, onChatUpdate)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" }, onChatDelete);
  state.channel = channel;
  channel.subscribe((status, err) => {
    if (status === "SUBSCRIBED") console.info("[chat] realtime SUBSCRIBED");
    else console.warn(`[chat] realtime ${status}`, err ?? "");
    // Connected (or reconnected): fetch anything sent while we weren't listening.
    if (status === "SUBSCRIBED") syncMissed();
    // CHANNEL_ERROR / TIMED_OUT are retried by supabase-js; a CLOSED channel is not.
    if (status === "CLOSED" && state.channel === channel) {
      state.channel = null;
      supabase.removeChannel(channel);
      setTimeout(subscribeChat, 3000);
    }
  });
}

/** Appends messages newer than the last one shown in the open room (duplicates are skipped). */
export async function syncMissed() {
  if (state.loading || !els.list) return;
  const room = state.room;
  let query = supabase.from("chat_messages").select(CHAT_COLUMNS);
  query = room ? query.eq("community_id", room.id) : query.is("community_id", null);
  if (state.lastAt) query = query.gte("created_at", state.lastAt);
  const { data, error } = await query.order("created_at", { ascending: true }).limit(HISTORY_LIMIT);
  if (error || room !== state.room || state.loading) return;
  const stick = nearBottom();
  data.forEach(appendMessage);
  scrollToEnd(stick);
}

// Realtime only delivers rows this guest may SELECT (chat_select RLS policy).
export async function onChatInsert(payload) {
  const row = payload.new;
  if (!row?.id) return;
  if (!inCurrentRoom(row)) {
    // Another room this guest can read (RLS only delivers those): count it and dot its chip.
    if (row.author_id !== state.me?.id) {
      setUnread(state.unread + 1);
      state.unreadRooms.add(row.community_id ?? "");
      renderRooms();
    }
    return;
  }
  if (!state.visible && row.author_id !== state.me?.id && !state.ids.has(row.id)) setUnread(state.unread + 1);
  if (state.loading) { state.pending.push(row); return; }
  if (!state.nicknames.has(row.author_id)) {
    const { data } = await supabase.from("profiles").select("nickname, avatar_url").eq("id", row.author_id).maybeSingle();
    if (data) {
      state.nicknames.set(row.author_id, data.nickname);
      state.avatars.set(row.author_id, data.avatar_url);
    }
  }
  const stick = nearBottom();
  appendMessage(row);
  scrollToEnd(stick);
}

export function onChatUpdate(payload) {
  const row = payload.new;
  if (!row?.id || !state.ids.has(row.id)) return;
  const next = { ...state.messages.get(row.id), ...row };
  state.messages.set(row.id, next);
  const element = [...els.list.querySelectorAll("[data-msg-id]")].find(el => el.dataset.msgId === row.id);
  if (element) element.outerHTML = messageHtml(next);
}

export function onChatDelete(payload) {
  if (payload.old?.id) removeMessage(payload.old.id);
}

function setUnread(count) {
  state.unread = count;
  els.unread.textContent = count > 99 ? "99+" : String(count);
  els.unread.hidden = count === 0;
}

// Everyone who has the app open joins one presence channel, keyed by profile
// id so several tabs of the same guest count once.
function trackPresence() {
  const channel = supabase.channel("wegoinn-presence", { config: { presence: { key: state.me.id } } });
  channel
    .on("presence", { event: "sync" }, () => {
      els.online.textContent = String(Object.keys(channel.presenceState()).length);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") await channel.track({ nickname: state.me.nickname });
    });
}
