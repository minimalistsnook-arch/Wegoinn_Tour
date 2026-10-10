// Live chat — Global Chat for every guest, plus a group chat per community
// (host + approved members; the database decides who may read or write).
// Messages are stored in chat_messages and pushed through Supabase Realtime;
// "online now" uses Realtime Presence.
import { supabase, errorMessage } from "./supabase.js";
import { $, escapeHtml, avatarHtml, formatDate, formatTime, toast, setBusy } from "./utils.js";
import { detectLanguage } from "./translation.js";
import { openSheet } from "./sheet.js";
import { icon } from "./icons.js";

const HISTORY_LIMIT = 100;
const CHAT_COLUMNS = "id, community_id, author_id, content, created_at, author:profiles ( nickname )";

const state = {
  me: null,
  room: null,          // null = Global Chat, otherwise { id, title }
  open: false,
  ids: new Set(),      // message ids currently rendered
  lastDay: "",
  unread: 0,
  nicknames: new Map(),
};

const els = {};

export function initChat(me) {
  state.me = me;
  state.nicknames.set(me.id, me.nickname);
  Object.assign(els, {
    fab: $("#chatFab"),
    unread: $("#chatUnread"),
    eyebrow: $("#chatEyebrow"),
    title: $("#chatTitle"),
    onlineWrap: $("#chatOnlineWrap"),
    online: $("#chatOnline"),
    list: $("#chatMessages"),
    form: $("#chatForm"),
    input: $("#chatInput"),
    send: $("#chatSend"),
  });

  els.fab.hidden = false;
  els.fab.addEventListener("click", () => openChat());
  els.form.addEventListener("submit", sendMessage);
  els.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      els.form.requestSubmit();
    }
  });
  els.input.addEventListener("input", onInput);
  els.list.addEventListener("click", onListClick);
  trackPresence();
}

function onInput() {
  els.send.disabled = !els.input.value.trim();
  els.input.style.height = "auto";
  els.input.style.height = `${els.input.scrollHeight}px`;
}

/** Opens Global Chat, or a community's group chat when `room` = { id, title }. */
export async function openChat(room = null) {
  state.room = room;
  state.open = true;
  if (!room) setUnread(0);
  els.eyebrow.textContent = room ? "Group chat" : "Everyone at Wegoinn";
  els.title.textContent = room ? room.title : "Global Chat";
  // Reset the site translator's memory of the previous room's title.
  delete els.title.dataset.siteOriginal;
  delete els.title.dataset.siteTranslated;
  els.title.toggleAttribute("data-user-content", Boolean(room));
  els.onlineWrap.hidden = Boolean(room);
  els.send.disabled = !els.input.value.trim();
  openSheet("chatSheet", () => { state.open = false; });
  await loadMessages();
  els.input.focus({ preventScroll: true });
}

async function loadMessages() {
  els.list.innerHTML = `<span class="loader"></span>`;
  let query = supabase.from("chat_messages").select(CHAT_COLUMNS);
  query = state.room ? query.eq("community_id", state.room.id) : query.is("community_id", null);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(HISTORY_LIMIT);
  if (error) {
    els.list.innerHTML = `<div class="empty-state">${escapeHtml(errorMessage(error, "Messages could not be loaded."))}</div>`;
    return;
  }
  state.ids.clear();
  state.lastDay = "";
  els.list.innerHTML = "";
  if (!data.length) els.list.innerHTML = `<p class="chat-empty">No messages yet — say hello 👋</p>`;
  data.reverse().forEach(appendMessage);
  scrollToEnd(true);
}

function inCurrentRoom(row) {
  return state.open && (row.community_id ?? null) === (state.room?.id ?? null);
}

function appendMessage(row) {
  if (state.ids.has(row.id)) return;
  state.ids.add(row.id);
  const nickname = row.author?.nickname ?? state.nicknames.get(row.author_id) ?? "Guest";
  state.nicknames.set(row.author_id, nickname);
  els.list.querySelector(".chat-empty")?.remove();

  const day = formatDate(row.created_at);
  if (day !== state.lastDay) {
    state.lastDay = day;
    els.list.insertAdjacentHTML("beforeend", `<p class="chat-day"><span>${escapeHtml(day)}</span></p>`);
  }
  const mine = row.author_id === state.me.id;
  els.list.insertAdjacentHTML("beforeend", `
    <article class="chat-msg ${mine ? "chat-msg--mine" : ""}" data-msg-id="${escapeHtml(row.id)}">
      ${mine ? "" : avatarHtml(nickname, "avatar--sm")}
      <div class="chat-msg__body">
        <div class="chat-msg__meta"><strong>${escapeHtml(mine ? "you" : nickname)}</strong><time>${escapeHtml(formatTime(row.created_at))}</time></div>
        <p class="chat-msg__text" data-user-content>${escapeHtml(row.content)}</p>
      </div>
      ${mine ? `<button type="button" class="icon-btn icon-btn--quiet chat-msg__delete" data-delete-msg="${escapeHtml(row.id)}" aria-label="Delete message">${icon("trash")}</button>` : ""}
    </article>`);
}

function nearBottom() {
  return els.list.scrollHeight - els.list.scrollTop - els.list.clientHeight < 120;
}

function scrollToEnd(force = false) {
  if (force || nearBottom()) requestAnimationFrame(() => (els.list.scrollTop = els.list.scrollHeight));
}

async function sendMessage(event) {
  event.preventDefault();
  const content = els.input.value.trim();
  if (!content) return;
  setBusy(els.send, true, "…");
  try {
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({ community_id: state.room?.id ?? null, content, original_language: detectLanguage(content) })
      .select(CHAT_COLUMNS)
      .single();
    if (error) throw error;
    els.input.value = "";
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
  const button = event.target.closest("[data-delete-msg]");
  if (!button || !confirm("Delete this message?")) return;
  button.disabled = true;
  const { data, error } = await supabase.from("chat_messages").delete().eq("id", button.dataset.deleteMsg).select("id");
  if (error || !data?.length) {
    button.disabled = false;
    return toast(error ? errorMessage(error) : "You don't have permission to do that.", "error");
  }
  removeMessage(button.dataset.deleteMsg);
}

function removeMessage(id) {
  [...els.list.querySelectorAll("[data-msg-id]")].find((el) => el.dataset.msgId === id)?.remove();
  state.ids.delete(id);
}

/* ---------------- Realtime ---------------- */

// Realtime only delivers rows this guest may SELECT (chat_select RLS policy).
export async function onChatInsert(payload) {
  const row = payload.new;
  if (!row?.id) return;
  if (!inCurrentRoom(row)) {
    if (row.community_id == null && row.author_id !== state.me?.id) setUnread(state.unread + 1);
    return;
  }
  if (!state.nicknames.has(row.author_id)) {
    const { data } = await supabase.from("profiles").select("nickname").eq("id", row.author_id).maybeSingle();
    if (data) state.nicknames.set(row.author_id, data.nickname);
  }
  const stick = nearBottom();
  appendMessage(row);
  scrollToEnd(stick);
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
