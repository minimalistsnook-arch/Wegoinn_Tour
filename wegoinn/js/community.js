import { mapLink, mapLocation, resolveMap, locationHtml } from "./maps.js";
import { supabase, errorMessage } from "./supabase.js";
import {
  $, escapeHtml, avatarHtml, avatarTone, toDateKey, parseDateKey, formatDateKey,
  shortTime, formatFee, toast, setBusy, debounce, koreaToday, communityIsLocked, safeMapUrl, displayLocale,
  COMMUNITY_LANGUAGES, languageName, applicationsClosed,
} from "./utils.js";
import { openSheet, closeSheet } from "./sheet.js";
import { icon } from "./icons.js";
import { openChat, setChatRooms } from "./chat.js";
import { isNew } from "./news.js";
import { mountCommunityComments } from "./community-comments.js";
import { moderationError } from "./moderation.js";
import { compressImage, uploadImage, isImageUploadConfigured } from "./image-upload.js";
import { validateCommunityRequiredFields, communityDateWithinStay } from "./community-validation.js";
import { t } from './i18n.js';

const COMMUNITY_COLUMNS = `
  *,
  creator:profiles ( nickname )`;

const today = koreaToday;

const state = {
  me: null,
  mine: [],
  extra: new Map(),
  editId: null,
  cursor: null,           // first day of the visible month
  selectedDate: today(),
  communities: [],        // everything in the visible grid range
  showAll: false,
  upcoming: [],
  myApplications: new Map(), // community_id → status
  languageHandler: null,
  refreshTimer: null,
  detailId: null,         // community open in the detail sheet
  detailTab: "info",      // info · members (chat jumps to the Chat page)
  cover: null,            // { file, url } compressed cover photo waiting to upload
  coverRemoved: false,    // editing: the saved photo was removed
  coverLoading: false,
};

import { accountDetailHtml } from "./operator-accounts.js";
import { installOperatorLongPress } from "./operator-longpress.js";

const els = {};

export function initCommunity(me) {
  document.addEventListener("chat-return-info", ({ detail }) => openDetail(detail));
  state.me = me;
  state.detailId = null;
  state.showAll = false;
  state.upcoming = [];
  state.extra.clear();
  if (state.languageHandler) document.removeEventListener("site-language-change", state.languageHandler);
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  const now = parseDateKey(today());
  state.cursor = new Date(now.getFullYear(), now.getMonth(), 1);

  Object.assign(els, {
    monthTitle: $("#calendarMonth"),
    grid: $("#calendarGrid"),
    prev: $("#prevMonth"),
    next: $("#nextMonth"),
    dayTitle: $("#selectedDateTitle"),
    dayCount: $("#selectedDateCount"),
    list: $("#communityList"),
    viewAll: $('#viewAllCommunities'),
    createBtn: $("#openCreateCommunity"),
    createDateLabel: $("#createDateLabel"),
    form: $("#communityForm"),
    feeAmountWrap: $("#feeAmountWrap"),
    feeAmount: $("#communityFee"),
    detail: $("#communityDetail"),
    coverInput: $("#communityImageInput"),
    coverPreview: $("#communityImagePreview"),
    coverRemove: $("#removeCommunityImage"),
  });

  els.form.elements.language.insertAdjacentHTML("beforeend", COMMUNITY_LANGUAGES
    .map((code) => `<option value="${code}">${escapeHtml(languageName(code, code))}</option>`).join(""));

  for (const list of [$('#myCommunityList'), els.list]) installOperatorLongPress(list, me, '.community-row[data-id], .meeting-item[data-id]', element => {
    const item = findCommunity(element.dataset.id);
    if (!item) return;
    return { authorId: item.creator_id, title: item.creator?.nickname,
      edit: () => openEditForm(item),
      delete: () => { const button = document.createElement('button'); button.dataset.action = 'delete-community'; button.dataset.id = item.id; return onDetailClick({ target: button }); } };
  });
  $("#myCommunityList").addEventListener("click", onCardClick);
  state.languageHandler = () => { renderCalendar(); renderDay(); renderMine(); if (state.detailId) renderDetail(); };
  document.addEventListener("site-language-change", state.languageHandler);
  state.refreshTimer = setInterval(() => { renderDay(); renderMine(); if (state.detailId) renderDetail(); }, 30000);
  els.prev.addEventListener("click", () => shiftMonth(-1));
  els.next.addEventListener("click", () => shiftMonth(1));
  els.grid.addEventListener("click", onGridClick);
  els.list.addEventListener("click", onCardClick);
  els.viewAll.addEventListener('click', async () => {
    state.showAll = !state.showAll;
    if (state.showAll) {
      state.selectedDate = today();
      setBusy(els.viewAll, true);
      try { await loadMonth(); } finally { setBusy(els.viewAll, false); }
    } else renderDay();
  });
  els.detail.addEventListener("click", onDetailClick);
  els.createBtn.addEventListener("click", openCreateForm);
  els.form.addEventListener("submit", submitCommunity);
  els.coverInput.addEventListener("change", pickCover);
  els.coverRemove.addEventListener("click", () => { setCover(null); state.coverRemoved = true; });
  els.form.elements.map_url.addEventListener("input", debounce(updateMapPreview, 400));
  els.form.elements.map_url.addEventListener("change", updateMapPreview);
  els.form.addEventListener("change", (e) => {
    if (e.target.name === "feeType") toggleFeeAmount();
  });

  return loadMonth();
}

/* ---------------- Data ---------------- */

function gridRange() {
  const y = state.cursor.getFullYear();
  const m = state.cursor.getMonth();
  const start = new Date(y, m, 1 - new Date(y, m, 1).getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 41); // 6 weeks
  return { start, end };
}

export async function loadMonth() {
  const { start, end } = gridRange();
  const [communities, applications] = await Promise.all([
    supabase
      .from("communities")
      .select(COMMUNITY_COLUMNS)
      .gte("community_date", toDateKey(start))
      .lte("community_date", toDateKey(end))
      .order("community_date")
      .order("community_time"),
    supabase
      .from("community_applications")
      .select("community_id, status")
      .eq("applicant_id", state.me.id),
  ]);

  if (communities.error) {
    toast(errorMessage(communities.error, "Couldn't load communities."), "error");
    return;
  }
  state.communities = communities.data;
  if (applications.error) { toast(errorMessage(applications.error), "error"); return; }
  state.myApplications = new Map((applications.data || []).map((a) => [a.community_id, a.status]));
  if (state.showAll) await loadUpcoming();
  renderCalendar();
  renderDay();
  await loadMine();
  if (state.detailId) renderDetail();
}

export const scheduleCommunityRefresh = debounce(loadMonth, 400);

async function loadUpcoming() {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('communities').select(COMMUNITY_COLUMNS)
      .gte('community_date', today()).order('community_date').order('community_time').order('id')
      .range(offset, offset + pageSize - 1);
    if (error) {
      toast(errorMessage(error, "Couldn't load communities."), 'error');
      state.showAll = false;
      return;
    }
    rows.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }
  state.upcoming = rows.filter(c => !communityIsLocked(c));
}

function shiftMonth(delta) {
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + delta, 1);
  loadMonth();
}

const byDate = (key) => state.communities.filter((c) => c.community_date === key);
const findCommunity = (id) => state.communities.find((c) => c.id === id) || state.upcoming.find(c => c.id === id) || state.mine.find((c) => c.id === id) || state.extra.get(id);
const isFull = (c) => c.approved_count >= c.max_participants;
// Communities created before the minimum existed default to 1.
const minOf = (c) => c.min_participants ?? 1;
const meetsMin = (c) => c.approved_count >= minOf(c);
// "2026-10-12T18:00:00" → { date: "2026-10-12", time: "18:00" }
const splitDeadline = (c) => {
  const [date = "", time = ""] = String(c.application_deadline || "").replace(" ", "T").split("T");
  return { date, time: time.slice(0, 5) };
};
function deadlineLabel(c) {
  const { date, time } = splitDeadline(c);
  return date ? `${formatDateKey(date, { month: "short", day: "numeric" })} ${time} KST` : "";
}
// Started without enough approved people: it does not go ahead.
const notHeld = (c) => c.status !== "cancelled" && communityIsLocked(c) && !meetsMin(c);
const isHost = (c) => c.creator_id === state.me.id;
const isAdmin = () => state.me?.role === "admin";
const canEdit = (c) => isAdmin() || (isHost(c) && !communityIsLocked(c));
// Group chat: host and approved members (enforced again by chat_messages RLS).
const canChat = (c) => isAdmin() || (c.status !== "cancelled" && (isHost(c) || state.myApplications.get(c.id) === "approved"));
// My communities: ones I host or joined that are still on.
const isMine = (c) => c.status !== "cancelled" && (isHost(c) || state.myApplications.get(c.id) === "approved");
const SOON_DAYS = 3; // my communities this close (today included) pulse on the calendar
// Communities an operator (admin) created: the hug picture stands in for the calendar day.
const isOfficial = (c) => c.is_official && c.status !== "cancelled";
const officialTag = (c) => c.is_official ? `<span class="tag tag--official" translate="no">WEGOINN OFFICIAL</span>` : "";
// The create form asks for one "About" text. It is saved in the existing columns: all of it in
// schedule, its start in activity (list previews) and this marker in preferred_participants.
// Older communities keep their three separate answers.
const ABOUT_MARK = "—";
const isCombined = (c) => c.preferred_participants === ABOUT_MARK;
const aboutText = (c) => isCombined(c) ? c.schedule : [
  c.activity && `What we'll do: ${c.activity}`,
  c.preferred_participants && `Who: ${c.preferred_participants}`,
  c.schedule && `Plan:\n${c.schedule}`,
].filter(Boolean).join("\n\n").slice(0, 1000);
// "approved" is shown as "joined": JOIN no longer waits for the host.
const statusLabel = (status) => (status === "approved" ? "joined" : status);

/* ---------------- Calendar ---------------- */

function renderCalendar() {
  els.monthTitle.innerHTML = `${new Intl.DateTimeFormat(displayLocale(), { month: "long" }).format(state.cursor)}
    <em>${state.cursor.getFullYear()}</em>`;

  const { start } = gridRange();
  const month = state.cursor.getMonth();
  const todayKey = today();
  const cells = [];

  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = toDateKey(d);
    const count = byDate(key).length;
    const mine = byDate(key).some(isMine);
    const official = byDate(key).some(isOfficial);
    const soon = mine && key >= todayKey && (parseDateKey(key) - parseDateKey(todayKey)) / 86400000 < SOON_DAYS;
    const classes = [
      "cal-day",
      d.getMonth() !== month && "is-outside",
      key === todayKey && "is-today",
      key === state.selectedDate && "is-selected",
      key < todayKey && "is-past",
      count && "has-events",
      mine && "is-mine",
      soon && "is-soon",
      official && "is-official",
    ].filter(Boolean).join(" ");

    const label = `${formatDateKey(key, { weekday: "long", month: "long", day: "numeric" })}${count ? `, ${count} ${count === 1 ? "community" : "communities"}` : ""}${official ? ", official Wegoinn community" : ""}${mine ? ", including yours" : ""}`;
    cells.push(`
      <button type="button" class="${classes}" data-date="${key}" aria-label="${escapeHtml(label)}" aria-pressed="${key === state.selectedDate}">
        ${official ? `<img class="cal-day__official" src="img/official-day.png" alt="" aria-hidden="true" decoding="async" />` : ""}
        <span class="cal-day__num">${d.getDate()}</span>
        ${count ? `<span class="cal-day__dot" aria-hidden="true"></span>` : ""}
        ${mine ? myCalendarPhoto() : ""}
      </button>`);
  }
  els.grid.innerHTML = cells.join("");
}

// One line of the detail facts list: icon tile · label · value.
const factRow = (name, label, value) => `
  <div class="detail-fact"><span class="detail-fact__icon" aria-hidden="true">${icon(name)}</span><small>${label}</small><b>${escapeHtml(value)}</b></div>`;

// My profile photo marks the days of my own communities.
function myCalendarPhoto() {
  const url = state.me.avatar_url;
  return url?.startsWith("https://")
    ? `<img class="cal-day__me" src="${escapeHtml(url)}" alt="" aria-hidden="true" loading="lazy" decoding="async" />`
    : `<span class="cal-day__me avatar avatar--${avatarTone(state.me.nickname)}" aria-hidden="true">${escapeHtml((state.me.nickname || "?").trim()[0] || "?")}</span>`;
}

function onGridClick(event) {
  const btn = event.target.closest("[data-date]");
  if (!btn) return;
  state.showAll = false;
  state.selectedDate = btn.dataset.date;
  const d = parseDateKey(state.selectedDate);
  if (d.getMonth() !== state.cursor.getMonth()) {
    state.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
    loadMonth();
  } else {
    renderCalendar();
    renderDay();
  }
}

/* ---------------- Selected date ---------------- */

function renderDay() {
  const list = state.showAll ? state.upcoming.filter(c => !communityIsLocked(c)) : byDate(state.selectedDate);
  els.viewAll.setAttribute('aria-pressed', String(state.showAll));
  els.dayTitle.textContent = state.showAll ? t('Upcoming communities') : formatDateKey(state.selectedDate, { weekday: "long", month: "long", day: "numeric" });
  els.dayCount.textContent = `${list.length} ${list.length === 1 ? "community" : "communities"}`;

  const isPast = state.selectedDate < today();
  els.createBtn.hidden = isPast;
  els.createDateLabel.textContent = formatDateKey(state.selectedDate, { month: "short", day: "numeric" });

  els.list.innerHTML = list.length
    ? list.map(dayItemHtml).join("")
    : `<div class="empty-state empty-state--soft">
         ${icon("sparkle")}
         <strong>${state.showAll ? 'No upcoming communities yet.' : isPast ? "No communities on this day" : "Nothing planned yet"}</strong>
         <p>${isPast ? "Pick another date to see what's happening." : "Be the one who brings everyone together."}</p>
       </div>`;
}

function joinButton(c, { wide = false, compact = false } = {}) {
  const status = state.myApplications.get(c.id);
  const cls = `btn ${wide ? "btn--block" : ""} ${compact ? "btn--sm community-row__action" : ""}`;
  if (!isAdmin() && communityIsLocked(c)) return `<button type="button" class="${cls}" disabled>${c.status === "cancelled" ? "CANCELLED" : notHeld(c) ? "NOT HELD · MINIMUM NOT MET" : "PAST · READ ONLY"}</button>`;
  if (isHost(c) || isAdmin()) return `<button type="button" class="${cls} btn--dark" data-action="view" data-id="${c.id}">MANAGE</button>`;
  // Pending (from before instant join) and withdrawn guests can simply join again.
  if (status === "approved" || status === "declined") return `<button type="button" class="${cls} btn--status btn--${status}" disabled>${statusLabel(status).toUpperCase()}</button>`;
  if (applicationsClosed(c)) return `<button type="button" class="${cls} btn--status btn--full" disabled>APPLICATIONS CLOSED</button>`;
  if (isFull(c)) return `<button type="button" class="${cls} btn--status btn--full" disabled>FULL</button>`;
  return `<button type="button" class="${cls} btn--primary" data-action="join" data-id="${c.id}">JOIN</button>`;
}

function capacityHtml(c) {
  const pct = Math.round((c.approved_count / c.max_participants) * 100);
  const min = minOf(c);
  const minPct = Math.round((min / c.max_participants) * 100);
  let minStatus = "";
  if (c.status !== "cancelled" && min > 1) {
    if (meetsMin(c)) minStatus = `<span class="tag tag--approved">Confirmed</span>`;
    else if (notHeld(c)) minStatus = `<span class="tag tag--declined">Not held</span>`;
    else minStatus = `<span class="tag tag--pending">Not confirmed</span><span><b>${min - c.approved_count}</b> more needed</span>`;
  }
  return `
    <div class="capacity ${isFull(c) ? "is-full" : ""}">
      <div class="capacity__label">
        <span>${icon("users")} <b>${c.approved_count} / ${c.max_participants}</b> people</span>
        ${isFull(c) ? `<span class="tag tag--full">FULL</span>` : ""}
      </div>
      <div class="capacity__bar" role="progressbar" aria-valuemin="0" aria-valuemax="${c.max_participants}" aria-valuenow="${c.approved_count}">
        <span style="width:${pct}%"></span>
        ${min > 1 ? `<i class="capacity__min-mark" style="left:${minPct}%" aria-hidden="true"></i>` : ""}
      </div>
      ${min > 1 ? `<div class="capacity__min"><span>Min</span> <b>${min}</b> ${minStatus}</div>` : ""}
    </div>`;
}

// Compact list row: when/language · title · activity preview · host, people, fee, deadline · action.
// The title button stretches over the whole row, so tapping anywhere opens the detail sheet.
function cardHtml(c) {
  const d = parseDateKey(c.community_date);
  const host = c.creator?.nickname ?? "Guest";
  const status = state.myApplications.get(c.id);
  const min = minOf(c);
  let minTag = "";
  if (c.status !== "cancelled" && min > 1) {
    if (meetsMin(c)) minTag = `<span class="tag tag--approved">Confirmed</span>`;
    else if (!notHeld(c)) minTag = `<span class="tag tag--pending">Not confirmed</span> <span><b>${min - c.approved_count}</b> more needed</span>`;
  }
  const tags = [
    officialTag(c),
    isNew("community", c.created_at, c.creator_id) && `<span class="tag tag--new">NEW</span>`,
    communityIsLocked(c) && `<span class="tag">${c.status === "cancelled" ? "Cancelled" : notHeld(c) ? "Not held" : "Past"}</span>`,
    isHost(c) ? `<span class="tag tag--host">Hosting</span>` : status && `<span class="tag tag--${status}">${statusLabel(status)}</span>`,
  ].filter(Boolean).join("");
  const action = isHost(c) ? "" : joinButton(c, { compact: true });
  return `
    <article class="community-row" data-id="${c.id}">
      <div class="community-row__body">
        <div class="community-row__text">
          <p class="community-row__cat">
            <span>${escapeHtml(formatDateKey(c.community_date, { weekday: "short" }))} ${escapeHtml(shortTime(c.community_time))} KST${c.language ? ` · ${escapeHtml(languageName(c.language))}` : ""}</span>
            ${tags}
          </p>
          <h3 class="community-row__title"><button type="button" data-action="view" data-id="${c.id}" data-user-content>${escapeHtml(c.title)}</button></h3>
          <p class="community-row__preview" data-user-content>${escapeHtml(c.activity)}</p>
        </div>
        <div class="date-chip date-chip--sm tone--${avatarTone(c.title)}" aria-hidden="true">
          <small>${new Intl.DateTimeFormat(displayLocale(), { month: "short" }).format(d)}</small>
          <b>${d.getDate()}</b>
        </div>
      </div>
      ${isAdmin() ? accountDetailHtml(c.creator_id) : ""}
      <div class="community-row__foot">
        <ul class="community-row__meta">
          <li class="community-row__host">${icon("user")}<span>${escapeHtml(host)}</span></li>
          <li class="${isFull(c) ? "is-full" : ""}">${icon("users")} <b>${c.approved_count}/${c.max_participants}</b>${min > 1 ? ` <span>Min</span> ${min}` : ""}</li>
          <li>${icon("ticket")} ${escapeHtml(formatFee(c.participation_fee))}</li>
          ${c.application_deadline ? `<li>${icon("clock")} <span>${applicationsClosed(c) ? "Applications closed" : "Apply by"}</span> ${escapeHtml(deadlineLabel(c))}</li>` : ""}
          ${minTag ? `<li>${minTag}</li>` : ""}
        </ul>
        ${action}
      </div>
    </article>`;
}

// Where I stand with a community: joined · pending · full · closed · past …
function dayStatusHtml(c) {
  const status = state.myApplications.get(c.id);
  if (c.status === "cancelled") return `<span class="tag tag--declined">Cancelled</span>`;
  if (notHeld(c)) return `<span class="tag tag--declined">Not held</span>`;
  if (isHost(c)) return `<span class="tag tag--host">Hosting</span>`;
  if (status) return `<span class="tag tag--${status}">${statusLabel(status)}</span>`;
  if (communityIsLocked(c)) return `<span class="tag tag--declined">Past</span>`;
  if (applicationsClosed(c)) return `<span class="tag tag--full">Applications closed</span>`;
  if (isFull(c)) return `<span class="tag tag--full">FULL</span>`;
  return "";
}

// Same rules as joinButton(): pending (from before instant join) and withdrawn guests may join again.
const canJoin = (c) => !isHost(c) && !isAdmin() && !communityIsLocked(c) && !applicationsClosed(c) && !isFull(c)
  && !["approved", "declined"].includes(state.myApplications.get(c.id));

// Selected-date list item: square thumbnail · title / activity / time · people · fee · status.
// Without a cover photo the thumbnail is a brand-tone tile with the title's first letter.
function dayItemHtml(c) {
  const min = minOf(c);
  const locked = communityIsLocked(c);
  let action = "";
  if (isAdmin() || (isHost(c) && !locked)) action = `<button type="button" class="btn btn--sm btn--ghost meeting-item__action" data-action="view" data-id="${c.id}">MANAGE</button>`;
  else if (canJoin(c)) action = `<button type="button" class="btn btn--sm btn--primary meeting-item__action" data-action="join" data-id="${c.id}">JOIN</button>`;
  const confirm = c.status !== "cancelled" && !locked && min > 1
    ? `<span class="tag tag--${meetsMin(c) ? "approved" : "pending"}">${meetsMin(c) ? "Confirmed" : "Not confirmed"}</span>` : "";
  const tags = `${officialTag(c)}${isNew("community", c.created_at, c.creator_id) ? `<span class="tag tag--new">NEW</span>` : ""}${dayStatusHtml(c)}${confirm}`;
  return `
    <article class="meeting-item" data-id="${c.id}">
      <div class="meeting-item__thumb tone--${avatarTone(c.title)}" aria-hidden="true" data-user-content>${c.image_url
        ? `<img src="${escapeHtml(c.image_url)}" alt="" loading="lazy" decoding="async" />`
        : escapeHtml(Array.from(c.title.trim())[0] || "")}</div>
      <div class="meeting-item__content">
        <h3 class="meeting-item__title"><button type="button" data-action="view" data-id="${c.id}" data-user-content>${escapeHtml(c.title)}</button></h3>
        <p class="meeting-item__desc" data-user-content>${escapeHtml(c.activity)}</p>
        <p class="meeting-item__meta">
          ${state.showAll ? `<span>${escapeHtml(formatDateKey(c.community_date, { year: 'numeric', month: 'short', day: 'numeric' }))}</span>` : ''}
          <span>${escapeHtml(shortTime(c.community_time))}</span>
          <span class="${isFull(c) ? "is-full" : ""}">${icon("users")}<b>${c.approved_count}/${c.max_participants}</b></span>
          <span>${escapeHtml(formatFee(c.participation_fee))}</span>
          ${c.language ? `<span>${escapeHtml(languageName(c.language))}</span>` : ""}
        </p>
        ${tags || action ? `<div class="meeting-item__foot"><span class="meeting-item__tags">${tags}</span>${action}</div>` : ""}
        ${isAdmin() ? accountDetailHtml(c.creator_id) : ""}
      </div>
    </article>`;
}

async function onCardClick(event) {
  const btn = event.target.closest("[data-action]");
  if (!btn) return;
  if (btn.dataset.action === "view") openDetail(btn.dataset.id);
  if (btn.dataset.action === "join") requestJoin(btn.dataset.id, btn);
}

/* ---------------- JOIN (straight in, no host review) ---------------- */

async function requestJoin(communityId, button) {
  const c = findCommunity(communityId);
  if (!c || isHost(c) || communityIsLocked(c)) return;
  if (applicationsClosed(c)) return toast("Applications are closed", "error");
  setBusy(button, true, "Joining…");
  // Atomic on the DB side: locks the community row, enforces the deadline and max_participants.
  const { data, error } = await supabase.rpc("join_community", { p_community_id: communityId }).single();
  setBusy(button, false);
  if (error) { toast(errorMessage(error), "error"); return loadMonth(); }
  toast("You're in! Say hi in the group chat.");
  state.myApplications.set(communityId, "approved");
  if (data) c.approved_count = data.approved_count;
  renderDay();
  if (state.detailId) renderDetail();
  await loadMine();
}

/* ---------------- Detail sheet (+ creator management) ---------------- */

function openDetail(id) {
  state.detailId = id;
  state.detailTab = "info";
  renderDetail();
  openSheet("communitySheet", () => { state.detailId = null; });
}

async function renderDetail() {
  if (document.activeElement?.closest("#communityComments") && document.activeElement.value) return;
  const c = findCommunity(state.detailId);
  if (!c) {
    els.detail.innerHTML = `<div class="empty-state">This community is no longer available.</div>`;
    return;
  }
  const host = c.creator?.nickname ?? "Guest";

  const tab = state.detailTab;
  const chatAction = canChat(c) ? "chat" : "chat-locked";
  els.detail.innerHTML = `
    <div class="detail-hero tone--${avatarTone(c.title)}">
      <p class="eyebrow">${escapeHtml(formatDateKey(c.community_date, { weekday: "long", month: "long", day: "numeric" }))} · ${escapeHtml(shortTime(c.community_time))} KST</p>
      <h2 data-user-content id="communitySheetTitle">${escapeHtml(c.title)}</h2>
      <div class="detail-host">${avatarHtml(host, "avatar--sm", c.creator?.avatar_url)} <span>hosted by <b>${escapeHtml(host)}</b></span></div>
    </div>

    <div class="detail-tabs" role="tablist" aria-label="Community">
      <button type="button" role="tab" id="detailTabInfo" aria-controls="detailPanelInfo" aria-selected="${tab === "info"}" data-tab="info">${icon("calendar")}<span>Info</span></button>
      <button type="button" role="tab" aria-selected="false" data-action="${chatAction}" data-id="${c.id}">${icon("message")}<span>Chat</span></button>
      <button type="button" role="tab" id="detailTabMembers" aria-controls="detailPanelMembers" aria-selected="${tab === "members"}" data-tab="members">${icon("users")}<span>Members</span> <b>${c.approved_count}</b></button>
    </div>

    <div id="detailPanelInfo" class="detail-panel" role="tabpanel" aria-labelledby="detailTabInfo" ${tab === "info" ? "" : "hidden"}>
      ${c.image_url ? `<img class="detail-cover" src="${escapeHtml(c.image_url)}" alt="" decoding="async" />` : ""}

      <div class="detail-facts">
        ${factRow("calendar", "Date", formatDateKey(c.community_date, { month: "short", day: "numeric" }))}
        ${factRow("clock", "Time", `${shortTime(c.community_time)} KST`)}
        ${factRow("ticket", "Fee", formatFee(c.participation_fee))}
        ${c.language ? factRow("globe", "Language", languageName(c.language)) : ""}
        ${c.application_deadline ? factRow("hourglass", applicationsClosed(c) ? "Applications closed" : "Apply by", deadlineLabel(c)) : ""}
      </div>

      ${communityIsLocked(c) && !isAdmin() ? `<p class="host-note">${c.status === "cancelled" ? "This community was cancelled. History is preserved." : notHeld(c) ? "This community didn't reach its minimum number of participants, so it won't go ahead." : "This community has started. History is read-only."}</p>` : ""}
      ${canEdit(c) ? `<div class="community-card__actions"><button class="btn btn--ghost" type="button" data-action="edit" data-id="${c.id}">Edit community</button>${isAdmin() ? `<button class="btn btn--soft" type="button" data-action="delete-community" data-id="${c.id}">Delete community</button>` : `<button class="btn btn--soft" type="button" data-action="cancel" data-id="${c.id}">Cancel community</button>`}</div>` : ""}
      ${!isHost(c) && !communityIsLocked(c) && ["pending","approved"].includes(state.myApplications.get(c.id)) ? `<button class="btn btn--ghost" type="button" data-action="withdraw" data-id="${c.id}">Leave community</button>` : ""}

      ${isCombined(c) ? `<section class="detail-block"><h3>About</h3><p data-user-content class="detail-plan">${escapeHtml(c.schedule)}</p></section>` : `
      <section class="detail-block"><h3>What we'll do</h3><p data-user-content>${escapeHtml(c.activity)}</p></section>
      <section class="detail-block"><h3>Who we'd love to meet</h3><p data-user-content>${escapeHtml(c.preferred_participants)}</p></section>
      <section class="detail-block"><h3>Plan</h3><p data-user-content class="detail-plan">${escapeHtml(c.schedule)}</p></section>`}
      <section class="detail-block"><h3>Meeting place</h3><p data-user-content>${escapeHtml(c.meeting_place || "Not specified")}</p>${mapLocation(c.map_url)?.coordinates ? `<p>${escapeHtml(mapLocation(c.map_url).coordinates)}</p>` : ""}${safeMapUrl(c.map_url) ? `<a class="btn btn--ghost" href="${escapeHtml(safeMapUrl(c.map_url))}" target="_blank" rel="noopener noreferrer">Open map</a>` : ""}</section>
      ${c.participation_fee > 0 ? `<p class="fee-note">${icon("ticket")} The fee is paid directly to the host — not through this app.</p>` : ""}

      <section id="communityComments" class="detail-block comments"><span class="loader"></span></section>
    </div>

    <div id="detailPanelMembers" class="detail-panel" role="tabpanel" aria-labelledby="detailTabMembers" ${tab === "members" ? "" : "hidden"}>
      ${membersSummaryHtml(c)}
      <section class="detail-block"><h3>Who's going</h3><div id="memberList"><span class="loader"></span></div></section>
      ${isHost(c) ? `<div id="hostPanel" class="host-panel"><div class="loader"></div></div>` : ""}
    </div>

    ${isHost(c) || isAdmin() ? "" : `<div class="detail-cta">${joinButton(c, { wide: true })}</div>`}
  `;

  mountCommunityComments(els.detail.querySelector("#communityComments"), c, state.me);
  if (isHost(c)) renderHostPanel(c);
  renderMembers(c);
}

// Members tab header: joined / max, the capacity bar, and how far the minimum is.
function membersSummaryHtml(c) {
  const min = minOf(c);
  const needed = Math.max(0, min - c.approved_count);
  const left = Math.max(0, c.max_participants - c.approved_count);
  let goal;
  if (c.status === "cancelled") goal = `<p class="members-goal">This community was cancelled.</p>`;
  else if (notHeld(c)) goal = `<p class="members-goal">This community didn't reach its minimum number of participants, so it won't go ahead.</p>`;
  else if (needed) goal = `<p class="members-goal is-short"><b>${needed}</b> <span>more needed to go ahead</span> <small>(min ${min})</small></p>`;
  else goal = `<p class="members-goal is-met">${icon("check")} <span>Minimum reached — this community will go ahead</span></p>`;
  return `
    <div class="members-summary">
      <div class="members-count"><b>${c.approved_count}</b><span>/ ${c.max_participants}</span><small>joined</small></div>
      ${goal}
      ${capacityHtml(c)}
      ${!communityIsLocked(c) ? `<p class="muted">${left ? `<b>${left}</b> <span>${left === 1 ? "spot left" : "spots left"}</span>` : "FULL"}</p>` : ""}
      ${!communityIsLocked(c) && !meetsMin(c) ? `<p class="host-note">Not confirmed yet. If fewer than the minimum are approved by the start time, this community won't go ahead.</p>` : ""}
    </div>`;
}

// Everyone signed in may see who's going (nickname + photo only) via the community_members RPC.
async function renderMembers(c) {
  const { data, error } = await supabase.rpc("community_members", { p_community_id: c.id });
  const list = els.detail.querySelector("#memberList");
  if (!list || state.detailId !== c.id) return;
  if (error) {
    list.innerHTML = `<p class="muted">${error.code === "PGRST202" ? "The member list isn't available yet." : escapeHtml(errorMessage(error))}</p>`;
    return;
  }
  const members = Array.isArray(data) ? data : [];
  const host = members.find(m => m.is_host);
  if (host?.avatar_url) {
    const avatar = els.detail.querySelector('.detail-host .avatar');
    if (avatar) avatar.outerHTML = avatarHtml(host.nickname || 'Guest', 'avatar--sm', host.avatar_url);
  }
  list.innerHTML = members.length ? `<ul class="member-list">${members.map((m) => {
    const name = m.nickname ?? "Guest";
    return `<li class="member">
      ${m.is_host ? `<span class="member__crown" aria-hidden="true">👑</span>` : ""}
      ${avatarHtml(name, "avatar--sm", m.avatar_url)}
      <span class="member__name" data-user-content>${escapeHtml(name)}</span>
      ${m.is_me ? `<span class="you-tag">you</span>` : ""}
      ${m.is_host ? `<span class="tag tag--host" translate="no">host</span>` : ""}
    </li>`;
  }).join("")}</ul>` : `<p class="muted">No one has joined yet.</p>`;
}

// Visible only to the creator — and the data itself is only readable by the
// creator (and admins) thanks to the applications_select RLS policy.
async function renderHostPanel(c) {
  const { data, error } = await supabase
    .from("community_applications")
    .select("id, status, created_at, reviewed_at, applicant:profiles ( nickname, avatar_url )")
    .eq("community_id", c.id)
    .order("created_at");

  const panel = $("#hostPanel");
  if (!panel || state.detailId !== c.id) return;
  if (error) {
    panel.innerHTML = `<p class="muted">${escapeHtml(errorMessage(error))}</p>`;
    return;
  }

  const pending = data.filter((a) => a.status === "pending");
  const full = isFull(c);
  const order = { pending: 0, approved: 1, declined: 2 };
  const sorted = [...data].sort((a, b) => order[a.status] - order[b.status]);

  panel.innerHTML = `
    <div class="host-panel__head">
      <p class="eyebrow">${icon("shield")} Only you can see this</p>
      <h3>Manage your community</h3>
    </div>
    <div class="host-stats">
      <div><b>${c.approved_count}</b><small>Approved</small></div>
      <div><b>${pending.length}</b><small>Pending</small></div>
      <div><b>${minOf(c)}</b><small>Min</small></div>
      <div><b>${c.max_participants}</b><small>Max</small></div>
    </div>
    ${full && pending.length ? `<p class="host-note">You've reached the maximum — no more approvals possible.</p>` : ""}
    <h4 class="host-panel__sub">Applicants</h4>
    ${sorted.length ? `<ul class="applicant-list">
      ${sorted.map((a) => {
        const name = a.applicant?.nickname ?? "Guest";
        return `
          <li class="applicant">
            ${avatarHtml(name, "avatar--sm", a.applicant?.avatar_url)}
            <span class="applicant__name">${escapeHtml(name)}</span>
            ${a.status === "pending" && !communityIsLocked(c) ? `
              <div class="applicant__actions">
                <button type="button" class="btn btn--sm btn--primary" data-review="approved" data-app-id="${a.id}" ${full ? "disabled" : ""}>APPROVE</button>
                <button type="button" class="btn btn--sm btn--soft" data-review="declined" data-app-id="${a.id}">DECLINE</button>
              </div>` : `<span class="tag tag--${a.status}">${a.status}</span>`}
          </li>`;
      }).join("")}
    </ul>` : `<p class="muted">No requests yet. Share the word in the guestbook!</p>`}
  `;
}

async function onDetailClick(event) {
  const tabBtn = event.target.closest("[data-tab]");
  if (tabBtn) {
    state.detailTab = tabBtn.dataset.tab;
    for (const b of els.detail.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b === tabBtn));
    els.detail.querySelector("#detailPanelInfo").hidden = state.detailTab !== "info";
    els.detail.querySelector("#detailPanelMembers").hidden = state.detailTab !== "members";
    return;
  }
  if (event.target.closest('[data-action="chat-locked"]')) return toast("Join this community to open its group chat.", "error");
  const action = event.target.closest("[data-action]");
  if (action?.dataset.action === "delete-community" && isAdmin()) {
    if (!confirm("Delete this community? Its comments, applications and group chat will also be deleted.")) return;
    setBusy(action, true);
    try {
      const { data, error } = await supabase.from("communities").delete().eq("id", action.dataset.id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("You do not have permission to delete this community.");
      state.extra.delete(action.dataset.id);
      closeSheet("communitySheet");
      state.detailId = null;
      await loadMonth();
      toast("Community deleted.");
    } catch (error) { toast(moderationError(error), "error"); } finally { setBusy(action, false); }
    return;
  }
  if (action && ["edit", "cancel", "withdraw"].includes(action.dataset.action)) {
    const c = findCommunity(action.dataset.id);
    if (!c || (communityIsLocked(c) && !(isAdmin() && action.dataset.action === "edit"))) return toast("This community is read-only", "error");
    if (action.dataset.action === "edit") return openEditForm(c);
    if (!confirm(action.dataset.action === "cancel" ? "Cancel this community? History will be preserved." : "Leave this community?")) return;
    setBusy(action, true);
    try {
      const { error } = await supabase.rpc(action.dataset.action === "cancel" ? "cancel_community" : "withdraw_application", { p_community_id: c.id });
      if (error) throw error;
      toast("Saved. History is preserved.");
      await loadMonth();
    } catch (err) { toast(errorMessage(err), "error"); } finally { setBusy(action, false); }
    return;
  }
  const chatBtn = event.target.closest('[data-action="chat"]');
  if (chatBtn) {
    const c = findCommunity(chatBtn.dataset.id);
    return c && openChat({ id: c.id, title: c.title });
  }
  const joinBtn = event.target.closest('[data-action="join"]');
  if (joinBtn) return requestJoin(joinBtn.dataset.id, joinBtn);

  const reviewBtn = event.target.closest("[data-review]");
  if (!reviewBtn) return;
  if (communityIsLocked(findCommunity(state.detailId))) return toast("This community is read-only", "error");
  const decision = reviewBtn.dataset.review;
  setBusy(reviewBtn, true, "…");
  // Atomic on the DB side: locks the community row and enforces max_participants.
  const { data, error } = await supabase
    .rpc("review_application", { p_application_id: reviewBtn.dataset.appId, p_decision: decision })
    .single();
  if (error) {
    setBusy(reviewBtn, false);
    toast(errorMessage(error), "error");
    return loadMonth();
  }
  const c = findCommunity(state.detailId);
  if (c) c.approved_count = data.approved_count;
  toast(decision === "approved" ? "Approved — welcome aboard!" : "Request declined.");
  loadMonth();
}

/* ---------------- Create community ---------------- */

let mapPreviewRequest = 0;
let resolvedMap = null;
async function updateMapPreview() {
  const sequence = ++mapPreviewRequest;
  resolvedMap = null;
  const preview = $("#mapLocationPreview");
  const input = els.form.elements.map_url;
  const value = input.value.trim();
  if (!preview) return;
  preview.hidden = !value;
  if (!value) { preview.textContent = ""; return; }
  preview.textContent = "Reading map location…";
  try {
    const info = await resolveMap(value, AbortSignal.timeout(12000));
    if (sequence !== mapPreviewRequest || input.value.trim() !== value) return;
    resolvedMap = { input: value, info };
    preview.innerHTML = locationHtml(info);
    const place = els.form.elements.meeting_place;
    if (!place.value.trim() || place.value === place.dataset.mapAutofill) {
      place.value = info.name || info.coordinates;
      place.dataset.mapAutofill = place.value;
    }
  } catch (error) {
    if (sequence === mapPreviewRequest && input.value.trim() === value) preview.textContent = error.message;
  }
}

function toggleFeeAmount() {
  const paid = els.form.elements.feeType.value === "paid";
  els.feeAmountWrap.hidden = !paid;
  els.feeAmount.required = paid;
  if (!paid) els.feeAmount.value = "";
}

/* ---------------- Cover photo ---------------- */

function setCover(cover) {
  if (state.cover?.url?.startsWith("blob:")) URL.revokeObjectURL(state.cover.url);
  state.cover = cover;
  els.coverPreview.hidden = !cover;
  if (cover) els.coverPreview.src = cover.url; else els.coverPreview.removeAttribute("src");
  els.coverRemove.hidden = !cover;
}

async function pickCover() {
  const file = els.coverInput.files?.[0];
  els.coverInput.value = "";
  if (!file || state.coverLoading) return;
  if (!isImageUploadConfigured()) return toast("Photo upload isn't connected yet.", "error");
  state.coverLoading = true;
  try {
    const compressed = await compressImage(file);
    setCover({ file: compressed, url: URL.createObjectURL(compressed) });
    state.coverRemoved = false;
  } catch (err) { toast(err.message, "error"); } finally { state.coverLoading = false; }
}

// Runs after the community itself is saved, so a photo problem never loses the community.
async function saveCover(id) {
  if (!state.cover?.file && !state.coverRemoved) return true;
  try {
    const url = state.cover?.file ? await uploadImage(state.cover.file) : null;
    const { error } = await supabase.rpc("set_community_image", { p_community_id: id, p_image_url: url });
    if (error) throw error;
    return true;
  } catch (err) {
    toast(err.code === "PGRST202" ? "Community saved, but photos aren't enabled yet. Please contact staff." : `Community saved, but the photo wasn't: ${errorMessage(err)}`, "error");
    return false;
  }
}

function openCreateForm() {
  const f = els.form;
  state.editId = null;
  $("#createTitle").textContent = "Create Community";
  f.querySelector("[type=submit]").textContent = "CREATE COMMUNITY";
  $("#communityReservationField").hidden = true;
  f.elements.reservation_number.required = false;
  f.reset();
  setCover(null);
  state.coverRemoved = false;
  updateMapPreview();
  f.elements.community_date.value = state.selectedDate;
  const dateInput = f.elements.community_date;
  dateInput.min = !isAdmin() && state.me.check_in > today() ? state.me.check_in : today();
  dateInput.max = isAdmin() ? "" : (state.me.check_out || "");
  if (dateInput.value < dateInput.min) dateInput.value = dateInput.min;
  if (dateInput.max && dateInput.value > dateInput.max) dateInput.value = "";
  f.elements.deadline_date.min = today();
  toggleFeeAmount();
  openSheet("createSheet");
  setTimeout(() => f.elements.title.focus({ preventScroll: true }), 300);
}

async function submitCommunity(event) {
  event.preventDefault();
  const f = els.form;
  const v = (name) => f.elements[name].value.trim();

  if (v("map_url") && !v("meeting_place")) await updateMapPreview();

  if (!validateCommunityRequiredFields(f)) return;
  if (!communityDateWithinStay(v("community_date"), state.me)) {
    f.elements.community_date.focus();
    return toast(state.me.check_in && state.me.check_out
      ? `모임 날짜는 숙박 기간(${state.me.check_in} ~ ${state.me.check_out}) 안에서 선택해 주세요.`
      : "숙박 정보를 확인할 수 없습니다. 다시 로그인해 주세요.", "error");
  }

  const max = Number(v("max_participants"));
  if (!Number.isInteger(max) || max < 2 || max > 30) return toast("Maximum participants must be 2 – 30.", "error");
  const min = Number(v("min_participants"));
  if (!Number.isInteger(min) || min < 1 || min > max) return toast("Minimum participants must be between 1 and the maximum.", "error");

  const paid = f.elements.feeType.value === "paid";
  const fee = paid ? Number(v("participation_fee")) : 0;
  if (paid && (!Number.isInteger(fee) || fee <= 0)) return toast("Please enter the fee in KRW.", "error");

  if (!(isAdmin() && state.editId) && communityIsLocked({ community_date: v("community_date"), community_time: v("community_time"), status: "active" })) return toast("Choose a future start time (KST)", "error");
  if (v("map_url") && !mapLink(v("map_url"))) return toast("Paste a Google, Naver or Kakao Maps link.", "error");

  const deadline = `${v("deadline_date")}T${v("deadline_time")}`;
  if (deadline > `${v("community_date")}T${v("community_time")}`) return toast("The application deadline must be on or before the start time.", "error");
  const original = state.editId && splitDeadline(findCommunity(state.editId) || {});
  const deadlineChanged = !original || `${original.date}T${original.time}` !== deadline;
  if (!(isAdmin() && state.editId) && deadlineChanged && applicationsClosed({ application_deadline: deadline })) return toast("Choose a future application deadline (KST)", "error");

  if (state.coverLoading) return toast("Your photo is still being prepared. Please try again in a moment.", "error");
  const submit = f.querySelector('[type="submit"]');
  setBusy(submit, true, "Creating…");
  const details = Object.fromEntries(["title", "community_date", "community_time", "meeting_place", "map_url"].map((name) => [name, v(name)]));
  Object.assign(details, { activity: v("about").slice(0, 500).trim(), preferred_participants: ABOUT_MARK, schedule: v("about") });
  details.map_url = resolvedMap?.input === v("map_url") ? mapLink(resolvedMap.info.url) : mapLink(v("map_url"));
  details.max_participants = max;
  details.min_participants = min;
  details.application_deadline = deadline;
  details.language = v("language");
  details.participation_fee = fee;
  let error, data;
  try {
    ({ data, error } = await supabase.rpc(state.editId ? "update_community" : "create_community_v2", state.editId
      ? { p_community_id: state.editId, p_details: details }
      : { p_reservation_number: null, p_details: details }));
  } catch (err) { error = err; }
  if (error) {
    setBusy(submit, false);
    if (error.code === "PGRST202") return toast("Community creation is temporarily unavailable. Please contact staff.", "error");
    return toast(errorMessage(error), "error");
  }

  const savedId = state.editId || (typeof data === "string" ? data : null);
  const coverSaved = savedId ? await saveCover(savedId) : true;
  setBusy(submit, false);
  const date = v("community_date");
  f.reset(); // clears the reservation number from the DOM right away
  closeSheet("createSheet");
  state.selectedDate = date;
  const d = parseDateKey(date);
  state.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
  if (coverSaved) toast(state.editId ? "Community updated." : "Your community is live 🎉");
  setCover(null);
  state.editId = null;
  await loadMonth();
}

function openEditForm(c) {
  if (!canEdit(c)) return;
  closeSheet("communitySheet");
  openCreateForm();
  state.editId = c.id;
  if (isAdmin()) {
    els.form.elements.community_date.min = "";
    els.form.elements.deadline_date.min = "";
  }
  $("#createTitle").textContent = "Edit community";
  els.form.querySelector("[type=submit]").textContent = "Save changes";
  $("#communityReservationField").hidden = true;
  els.form.elements.reservation_number.required = false;
  for (const key of ["title","community_date","community_time","max_participants","meeting_place","map_url"]) els.form.elements[key].value = c[key] ?? "";
  els.form.elements.about.value = aboutText(c);
  els.form.elements.min_participants.value = minOf(c);
  // Communities created before deadlines existed accepted requests until the start.
  const { date, time } = c.application_deadline ? splitDeadline(c) : { date: c.community_date, time: shortTime(c.community_time) };
  els.form.elements.deadline_date.value = date;
  els.form.elements.deadline_time.value = time;
  els.form.elements.language.value = c.language || "";
  updateMapPreview();
  els.form.elements.feeType.value = c.participation_fee > 0 ? "paid" : "free";
  toggleFeeAmount();
  els.form.elements.participation_fee.value = c.participation_fee || "";
  if (c.image_url) setCover({ url: c.image_url });
}

async function loadMine() {
  const ids = [...state.myApplications.keys()];
  let query = supabase.from("communities").select(COMMUNITY_COLUMNS).order("community_date", { ascending: false }).order("community_time", { ascending: false });
  if (!isAdmin()) query = ids.length ? query.or(`creator_id.eq.${state.me.id},id.in.(${ids.join(",")})`) : query.eq("creator_id", state.me.id);
  const { data, error } = await query;
  if (error) { $("#myCommunityList").textContent = errorMessage(error); return; }
  state.mine = data;
  renderMine();
  setChatRooms(state.mine.filter(canChat).map((c) => ({ id: c.id, title: c.title, date: c.community_date, time: c.community_time, image: c.image_url, place: c.meeting_place, members: c.approved_count })));
}
function renderMine() {
  $("#myCommunityList").innerHTML = state.mine.length ? state.mine.map(cardHtml).join("") : '<p class="empty-state">No communities yet.</p>';
}

export async function openCommunityById(id) {
  if (!findCommunity(id)) {
    const { data, error } = await supabase.from("communities").select(COMMUNITY_COLUMNS).eq("id", id).single();
    if (error || !data) return toast(errorMessage(error, "This community is no longer available."), "error");
    state.extra.set(id, data);
  }
  closeSheet("notificationSheet");
  if (location.hash !== "#community") location.hash = "community";
  openDetail(id);
}
