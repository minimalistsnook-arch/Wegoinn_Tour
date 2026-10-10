import { mapLink, mapLocation, resolveMap, locationHtml } from "./maps.js";
import { supabase, errorMessage } from "./supabase.js";
import {
  $, escapeHtml, avatarHtml, avatarTone, toDateKey, parseDateKey, formatDateKey,
  shortTime, formatFee, toast, setBusy, debounce, koreaToday, communityIsLocked, safeMapUrl, displayLocale,
} from "./utils.js";
import { openSheet, closeSheet } from "./sheet.js";
import { icon } from "./icons.js";
import { openChat } from "./chat.js";

const COMMUNITY_COLUMNS = `
  id, creator_id, title, activity, preferred_participants, schedule,
  community_date, community_time, max_participants, participation_fee, approved_count, created_at, status, meeting_place, map_url,
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
  myApplications: new Map(), // community_id → status
  detailId: null,         // community open in the detail sheet
};

const els = {};

export function initCommunity(me) {
  state.me = me;
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
    createBtn: $("#openCreateCommunity"),
    createDateLabel: $("#createDateLabel"),
    form: $("#communityForm"),
    feeAmountWrap: $("#feeAmountWrap"),
    feeAmount: $("#communityFee"),
    detail: $("#communityDetail"),
  });

  $("#myCommunityList").addEventListener("click", onCardClick);
  document.addEventListener("site-language-change", () => { renderCalendar(); renderDay(); renderMine(); if (state.detailId) renderDetail(); });
  setInterval(() => { renderDay(); renderMine(); if (state.detailId) renderDetail(); }, 30000);
  els.prev.addEventListener("click", () => shiftMonth(-1));
  els.next.addEventListener("click", () => shiftMonth(1));
  els.grid.addEventListener("click", onGridClick);
  els.list.addEventListener("click", onCardClick);
  els.detail.addEventListener("click", onDetailClick);
  els.createBtn.addEventListener("click", openCreateForm);
  els.form.addEventListener("submit", submitCommunity);
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
  renderCalendar();
  renderDay();
  await loadMine();
  if (state.detailId) renderDetail();
}

export const scheduleCommunityRefresh = debounce(loadMonth, 400);

function shiftMonth(delta) {
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + delta, 1);
  loadMonth();
}

const byDate = (key) => state.communities.filter((c) => c.community_date === key);
const findCommunity = (id) => state.communities.find((c) => c.id === id) || state.mine.find((c) => c.id === id) || state.extra.get(id);
const isFull = (c) => c.approved_count >= c.max_participants;
const isHost = (c) => c.creator_id === state.me.id;
// Group chat: host and approved members (enforced again by chat_messages RLS).
const canChat = (c) => c.status !== "cancelled" && (isHost(c) || state.myApplications.get(c.id) === "approved");

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
    const classes = [
      "cal-day",
      d.getMonth() !== month && "is-outside",
      key === todayKey && "is-today",
      key === state.selectedDate && "is-selected",
      key < todayKey && "is-past",
      count && "has-events",
    ].filter(Boolean).join(" ");

    const label = `${formatDateKey(key, { weekday: "long", month: "long", day: "numeric" })}${count ? `, ${count} ${count === 1 ? "community" : "communities"}` : ""}`;
    cells.push(`
      <button type="button" class="${classes}" data-date="${key}" aria-label="${escapeHtml(label)}" aria-pressed="${key === state.selectedDate}">
        <span class="cal-day__num">${d.getDate()}</span>
        ${count ? `<span class="cal-day__dot" aria-hidden="true"></span>` : ""}
      </button>`);
  }
  els.grid.innerHTML = cells.join("");
}

function onGridClick(event) {
  const btn = event.target.closest("[data-date]");
  if (!btn) return;
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
  const list = byDate(state.selectedDate);
  els.dayTitle.textContent = formatDateKey(state.selectedDate, { weekday: "long", month: "long", day: "numeric" });
  els.dayCount.textContent = `${list.length} ${list.length === 1 ? "community" : "communities"}`;

  const isPast = state.selectedDate < today();
  els.createBtn.hidden = isPast;
  els.createDateLabel.textContent = formatDateKey(state.selectedDate, { month: "short", day: "numeric" });

  els.list.innerHTML = list.length
    ? list.map(cardHtml).join("")
    : `<div class="empty-state empty-state--soft">
         ${icon("sparkle")}
         <strong>${isPast ? "No communities on this day" : "Nothing planned yet"}</strong>
         <p>${isPast ? "Pick another date to see what's happening." : "Be the one who brings everyone together."}</p>
       </div>`;
}

function joinButton(c, { wide = false } = {}) {
  const status = state.myApplications.get(c.id);
  const cls = `btn ${wide ? "btn--block" : ""}`;
  if (communityIsLocked(c)) return `<button type="button" class="${cls}" disabled>${c.status === "cancelled" ? "CANCELLED" : "PAST · READ ONLY"}</button>`;
  if (isHost(c)) return `<button type="button" class="${cls} btn--dark" data-action="view" data-id="${c.id}">MANAGE</button>`;
  if (status) return `<button type="button" class="${cls} btn--status btn--${status}" disabled>${status.toUpperCase()}</button>`;
  if (isFull(c)) return `<button type="button" class="${cls} btn--status btn--full" disabled>FULL</button>`;
  return `<button type="button" class="${cls} btn--primary" data-action="join" data-id="${c.id}">JOIN</button>`;
}

function capacityHtml(c) {
  const pct = Math.round((c.approved_count / c.max_participants) * 100);
  return `
    <div class="capacity ${isFull(c) ? "is-full" : ""}">
      <div class="capacity__label">
        <span>${icon("users")} <b>${c.approved_count} / ${c.max_participants}</b> people</span>
        ${isFull(c) ? `<span class="tag tag--full">FULL</span>` : ""}
      </div>
      <div class="capacity__bar" role="progressbar" aria-valuemin="0" aria-valuemax="${c.max_participants}" aria-valuenow="${c.approved_count}">
        <span style="width:${pct}%"></span>
      </div>
    </div>`;
}

function cardHtml(c) {
  const d = parseDateKey(c.community_date);
  const host = c.creator?.nickname ?? "Guest";
  const status = state.myApplications.get(c.id);
  return `
    <article class="community-card tone--${avatarTone(c.title)}" data-id="${c.id}">
      <div class="community-card__top">
        <div class="date-chip" aria-hidden="true">
          <small>${new Intl.DateTimeFormat(displayLocale(), { month: "short" }).format(d)}</small>
          <b>${d.getDate()}</b>
        </div>
        <div class="community-card__heading">
          <h3 data-user-content>${escapeHtml(c.title)}</h3>
          <p>hosted by ${escapeHtml(host)}</p>
        </div>
        ${communityIsLocked(c) ? `<span class="tag">${c.status === "cancelled" ? "Cancelled" : "Past"}</span>` : ""}
        ${isHost(c) ? `<span class="tag tag--host">Hosting</span>` : status ? `<span class="tag tag--${status}">${status}</span>` : ""}
      </div>

      <ul class="meta-list">
        <li>${icon("calendar")} ${escapeHtml(formatDateKey(c.community_date, { weekday: "short", month: "short", day: "numeric" }))}</li>
        <li>${icon("clock")} ${escapeHtml(shortTime(c.community_time))} KST</li>
        <li>${icon("ticket")} ${escapeHtml(formatFee(c.participation_fee))}</li>
      </ul>

      ${capacityHtml(c)}

      <div class="community-card__actions">
        <button type="button" class="btn btn--ghost" data-action="view" data-id="${c.id}">VIEW</button>
        ${joinButton(c)}
      </div>
    </article>`;
}

async function onCardClick(event) {
  const btn = event.target.closest("[data-action]");
  if (!btn) return;
  if (btn.dataset.action === "view") openDetail(btn.dataset.id);
  if (btn.dataset.action === "join") requestJoin(btn.dataset.id, btn);
}

/* ---------------- JOIN (pending → creator reviews) ---------------- */

async function requestJoin(communityId, button) {
  const c = findCommunity(communityId);
  if (!c || isHost(c) || communityIsLocked(c)) return;
  setBusy(button, true, "Sending…");
  // applicant_id and status='pending' come from DB defaults; RLS re-checks everything.
  const { error } = await supabase.from("community_applications").insert({ community_id: communityId });
  setBusy(button, false);
  if (error) return toast(errorMessage(error), "error");
  toast("Request sent! The host will review it soon.");
  state.myApplications.set(communityId, "pending");
  renderDay();
  if (state.detailId) renderDetail();
}

/* ---------------- Detail sheet (+ creator management) ---------------- */

function openDetail(id) {
  state.detailId = id;
  renderDetail();
  openSheet("communitySheet", () => { state.detailId = null; });
}

async function renderDetail() {
  const c = findCommunity(state.detailId);
  if (!c) {
    els.detail.innerHTML = `<div class="empty-state">This community is no longer available.</div>`;
    return;
  }
  const host = c.creator?.nickname ?? "Guest";

  els.detail.innerHTML = `
    <div class="detail-hero tone--${avatarTone(c.title)}">
      <p class="eyebrow">${escapeHtml(formatDateKey(c.community_date, { weekday: "long", month: "long", day: "numeric" }))} · ${escapeHtml(shortTime(c.community_time))} KST</p>
      <h2 data-user-content id="communitySheetTitle">${escapeHtml(c.title)}</h2>
      <div class="detail-host">${avatarHtml(host, "avatar--sm")} <span>hosted by <b>${escapeHtml(host)}</b></span></div>
    </div>

    <div class="detail-facts">
      <div><small>Date</small><b>${escapeHtml(formatDateKey(c.community_date, { month: "short", day: "numeric" }))}</b></div>
      <div><small>Time</small><b>${escapeHtml(shortTime(c.community_time))} KST</b></div>
      <div><small>Fee</small><b>${escapeHtml(formatFee(c.participation_fee))}</b></div>
    </div>

    ${capacityHtml(c)}
    <section class="detail-block"><h3>Meeting place</h3><p data-user-content>${escapeHtml(c.meeting_place || "Not specified")}</p>${mapLocation(c.map_url)?.coordinates ? `<p>${escapeHtml(mapLocation(c.map_url).coordinates)}</p>` : ""}${safeMapUrl(c.map_url) ? `<a class="btn btn--ghost" href="${escapeHtml(safeMapUrl(c.map_url))}" target="_blank" rel="noopener noreferrer">Open map</a>` : ""}</section>
    ${communityIsLocked(c) ? `<p class="host-note">${c.status === "cancelled" ? "This community was cancelled. History is preserved." : "This community has started. History is read-only."}</p>` : ""}
    ${isHost(c) && !communityIsLocked(c) ? `<div class="community-card__actions"><button class="btn btn--ghost" type="button" data-action="edit" data-id="${c.id}">Edit community</button><button class="btn btn--soft" type="button" data-action="cancel" data-id="${c.id}">Cancel community</button></div>` : ""}
    ${canChat(c) ? `<button class="btn btn--dark btn--block" type="button" data-action="chat" data-id="${c.id}">${icon("message")} Open group chat</button>` : ""}
    ${!isHost(c) && !communityIsLocked(c) && ["pending","approved"].includes(state.myApplications.get(c.id)) ? `<button class="btn btn--ghost" type="button" data-action="withdraw" data-id="${c.id}">Withdraw application</button>` : ""}

    <section class="detail-block"><h3>What we'll do</h3><p data-user-content>${escapeHtml(c.activity)}</p></section>
    <section class="detail-block"><h3>Who we'd love to meet</h3><p data-user-content>${escapeHtml(c.preferred_participants)}</p></section>
    <section class="detail-block"><h3>Plan</h3><p data-user-content class="detail-plan">${escapeHtml(c.schedule)}</p></section>
    ${c.participation_fee > 0 ? `<p class="fee-note">${icon("ticket")} The fee is paid directly to the host — not through this app.</p>` : ""}

    ${isHost(c) ? `<div id="hostPanel" class="host-panel"><div class="loader"></div></div>`
                : `<div class="detail-cta">${joinButton(c, { wide: true })}</div>`}
  `;

  if (isHost(c)) renderHostPanel(c);
}

// Visible only to the creator — and the data itself is only readable by the
// creator (and admins) thanks to the applications_select RLS policy.
async function renderHostPanel(c) {
  const { data, error } = await supabase
    .from("community_applications")
    .select("id, status, created_at, reviewed_at, applicant:profiles ( nickname )")
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
      <div><b>${c.max_participants}</b><small>Max</small></div>
    </div>
    ${full && pending.length ? `<p class="host-note">You've reached the maximum — no more approvals possible.</p>` : ""}
    <h4 class="host-panel__sub">Applicants</h4>
    ${sorted.length ? `<ul class="applicant-list">
      ${sorted.map((a) => {
        const name = a.applicant?.nickname ?? "Guest";
        return `
          <li class="applicant">
            ${avatarHtml(name, "avatar--sm")}
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
  const action = event.target.closest("[data-action]");
  if (action && ["edit", "cancel", "withdraw"].includes(action.dataset.action)) {
    const c = findCommunity(action.dataset.id);
    if (!c || communityIsLocked(c)) return toast("This community is read-only", "error");
    if (action.dataset.action === "edit") return openEditForm(c);
    if (!confirm(action.dataset.action === "cancel" ? "Cancel this community? History will be preserved." : "Withdraw your application?")) return;
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

function openCreateForm() {
  const f = els.form;
  state.editId = null;
  $("#createTitle").textContent = "Create Community";
  f.querySelector("[type=submit]").textContent = "CREATE COMMUNITY";
  $("#communityReservationField").hidden = true;
  f.elements.reservation_number.required = false;
  f.reset();
  updateMapPreview();
  f.elements.community_date.value = state.selectedDate;
  f.elements.community_date.min = today();
  toggleFeeAmount();
  openSheet("createSheet");
  setTimeout(() => f.elements.title.focus({ preventScroll: true }), 300);
}

async function submitCommunity(event) {
  event.preventDefault();
  const f = els.form;
  const v = (name) => f.elements[name].value.trim();

  if (v("map_url") && !v("meeting_place")) await updateMapPreview();

  const required = ["community_date", "community_time", "title", "activity", "preferred_participants", "schedule", "max_participants", "meeting_place"];
  if (required.some((name) => !v(name))) return toast("Please fill in every field.", "error");

  const max = Number(v("max_participants"));
  if (!Number.isInteger(max) || max < 1 || max > 30) return toast("Maximum participants must be 1 – 30.", "error");

  const paid = f.elements.feeType.value === "paid";
  const fee = paid ? Number(v("participation_fee")) : 0;
  if (paid && (!Number.isInteger(fee) || fee <= 0)) return toast("Please enter the fee in KRW.", "error");

  if (communityIsLocked({ community_date: v("community_date"), community_time: v("community_time"), status: "active" })) return toast("Choose a future start time (KST)", "error");
  if (v("map_url") && !mapLink(v("map_url"))) return toast("Paste a Google, Naver or Kakao Maps link.", "error");

  const submit = f.querySelector('[type="submit"]');
  setBusy(submit, true, "Creating…");
  const details = Object.fromEntries(["title", "activity", "preferred_participants", "schedule", "community_date", "community_time", "meeting_place", "map_url"].map((name) => [name, v(name)]));
  details.map_url = resolvedMap?.input === v("map_url") ? mapLink(resolvedMap.info.url) : mapLink(v("map_url"));
  details.max_participants = max;
  details.participation_fee = fee;
  let error;
  try {
    ({ error } = await supabase.rpc(state.editId ? "update_community" : "create_community_v2", state.editId
      ? { p_community_id: state.editId, p_details: details }
      : { p_reservation_number: null, p_details: details }));
  } catch (err) { error = err; }
  setBusy(submit, false);
  if (error) return toast(errorMessage(error), "error");

  const date = v("community_date");
  f.reset(); // clears the reservation number from the DOM right away
  closeSheet("createSheet");
  state.selectedDate = date;
  const d = parseDateKey(date);
  state.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
  toast(state.editId ? "Community updated." : "Your community is live 🎉");
  state.editId = null;
  await loadMonth();
}

function openEditForm(c) {
  if (!isHost(c) || communityIsLocked(c)) return;
  closeSheet("communitySheet");
  openCreateForm();
  state.editId = c.id;
  $("#createTitle").textContent = "Edit community";
  els.form.querySelector("[type=submit]").textContent = "Save changes";
  $("#communityReservationField").hidden = true;
  els.form.elements.reservation_number.required = false;
  for (const key of ["title","activity","preferred_participants","schedule","community_date","community_time","max_participants","meeting_place","map_url"]) els.form.elements[key].value = c[key] ?? "";
  updateMapPreview();
  els.form.elements.feeType.value = c.participation_fee > 0 ? "paid" : "free";
  toggleFeeAmount();
  els.form.elements.participation_fee.value = c.participation_fee || "";
}

async function loadMine() {
  const ids = [...state.myApplications.keys()];
  let query = supabase.from("communities").select(COMMUNITY_COLUMNS).order("community_date", { ascending: false }).order("community_time", { ascending: false });
  query = ids.length ? query.or(`creator_id.eq.${state.me.id},id.in.(${ids.join(",")})`) : query.eq("creator_id", state.me.id);
  const { data, error } = await query;
  if (error) { $("#myCommunityList").textContent = errorMessage(error); return; }
  state.mine = data;
  renderMine();
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
  openDetail(id);
}
