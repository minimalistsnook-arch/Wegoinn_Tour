import { ensureCommunityConsent, renderTermsSettings } from './community-terms.js';
import { initSiteLanguage } from "./i18n.js";
import { initNotifications, refreshNotifications } from "./notifications.js";
import { supabase, errorMessage } from "./supabase.js";
import { isSupabaseConfigured } from "./config.js";
import { signInGuest, getMyProfile, normalizeStayDate, checkStayStatus } from "./auth.js";
import { compressAvatar } from "./image-upload.js";
import { initGuestbook, scheduleFeedRefresh } from "./guestbook.js";
import { initCommunity, scheduleCommunityRefresh } from "./community.js";
import { initNews, sectionInView, scheduleNewCommunities, scheduleNewPosts } from "./news.js";
import { initChat } from "./chat.js";
import { $, $$, avatarHtml, toast, setBusy } from "./utils.js";
import { hydrateIcons, icon } from "./icons.js";
import { initTheme } from "./theme.js";
import { loginErrorMessage } from "./login-errors.js";
import { initOnlinePresence } from "./online-presence.js";
import { initProfilePhotoViewer } from "./profile-photo.js";

import { initOperatorAccounts, watchSessionActivity } from "./operator-accounts.js";

hydrateIcons();
initTheme();
initSiteLanguage();
initProfilePhotoViewer();
const LOGOUT_REASON = "wegoinn-logout-reason";
const SIGNED_IN = "wegoinn-signed-in";
const STAY_ENDED_MESSAGE = "체크아웃 날짜가 지났거나 체크아웃 처리되어 자동으로 로그아웃되었습니다.";
const storage = {
  get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* private mode */ } },
};

$("#logoutBtn").addEventListener("click", async () => {
  await Promise.resolve(supabase.rpc("touch_guest_session", { p_sign_out: true })).catch(() => {});
  storage.set(SIGNED_IN, null);
  const { error } = await supabase.auth.signOut();
  if (error) toast(errorMessage(error), "error");
});

const views = { login: $("#loginView"), app: $("#appView"), loading: $("#loadingView") };

function show(name) {
  Object.entries(views).forEach(([key, el]) => (el.hidden = key !== name));
}

async function boot() {
  if (!isSupabaseConfigured()) {
    $("#setupNotice").hidden = false;
    $("#loginForm button[type=submit]").disabled = true;
    show("login");
    return;
  }
  try {
    const profile = await getMyProfile();
    if (profile) return enterApp(profile);
    // Signed in before but the profile is gone: the stay is over (the database hides ended stays).
    const { data: { session } } = await supabase.auth.getSession();
    if (session && storage.get(SIGNED_IN)) return endStay();
  } catch (err) {
    console.warn(err);
  }
  showLogoutReason();
  show("login");
}

function showLogoutReason() {
  const reason = storage.get(LOGOUT_REASON);
  if (!reason) return;
  storage.set(LOGOUT_REASON, null);
  $("#loginError").textContent = reason;
  $("#loginError").hidden = false;
}

// Signs out a guest whose stay is over; the login screen then explains why.
async function endStay() {
  storage.set(SIGNED_IN, null);
  storage.set(LOGOUT_REASON, STAY_ENDED_MESSAGE);
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  location.reload();
}

// Re-checks the stay while the app is open: every few minutes and whenever the tab comes back.
function watchStay() {
  let checking = false;
  const check = async () => {
    if (checking || document.visibilityState === "hidden") return;
    checking = true;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return; // already signed out; onAuthStateChange takes over
      const profile = await getMyProfile().catch(() => undefined);
      if (profile === null || (await checkStayStatus())?.active === false) await endStay();
    } finally {
      checking = false;
    }
  };
  setInterval(check, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", check);
}

// Keep free-text entry (including the operator code) alongside a native calendar.
$$("[data-stay-calendar]").forEach((picker) => {
  const input = $("#loginForm").elements[picker.dataset.stayCalendar];
  const syncCalendar = () => {
    try {
      const value = normalizeStayDate(input.value);
      picker.value = value === "999222" ? "" : value;
    } catch {
      picker.value = "";
    }
  };
  const openCalendar = () => {
    syncCalendar();
    try { picker.showPicker?.(); } catch { /* Native control remains clickable. */ }
  };
  // Only the calendar icon opens the picker; opening it from the text box steals typing (e.g. 999222).
  input.addEventListener("input", syncCalendar);
  picker.addEventListener("click", openCalendar);
  picker.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && picker.showPicker) {
      event.preventDefault();
      openCalendar();
    }
  });
  picker.addEventListener("change", () => {
    if (!picker.value) return;
    input.value = picker.value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
});

// Optional round profile photo. Only the compressed square crop is kept.
let avatarFile = null;
let avatarPreviewUrl = "";
function setAvatar(file) {
  avatarFile = file;
  if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
  avatarPreviewUrl = file ? URL.createObjectURL(file) : "";
  $("#avatarPreview").src = avatarPreviewUrl;
  $("#avatarPreview").hidden = !file;
  $("#avatarRemove").hidden = !file;
}
$("#avatarPickBtn").addEventListener("click", () => $("#avatarInput").click());
$("#avatarRemove").addEventListener("click", () => setAvatar(null));
$("#avatarInput").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const [file] = input.files;
  input.value = "";
  if (!file) return;
  try {
    setAvatar(await compressAvatar(file));
  } catch (err) {
    toast(errorMessage(err), "error");
  }
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const checkIn = form.elements.check_in;
  const checkOut = form.elements.check_out;
  const room = form.elements.room_number;
  const nickname = form.elements.nickname;
  const loginError = $("#loginError");
  loginError.hidden = true;
  loginError.textContent = "";
  const button = form.querySelector('[type="submit"]');
  setBusy(button, true, "Entering…");
  try {
    const profile = await signInGuest(checkIn.value, checkOut.value, room.value, nickname.value, avatarFile);
    checkIn.value = checkOut.value = room.value = "";
    setAvatar(null);
    await enterApp(profile);
  } catch (err) {
    const message = loginErrorMessage(err);
    loginError.textContent = message;
    loginError.hidden = false;
    toast(message, "error");
  } finally {
    setBusy(button, false);
  }
});

let started = false;

async function enterApp(profile) {
  if (started) return;
  await ensureCommunityConsent();
  started = true;

  if (profile.role !== "admin") {
    const { data, error } = await supabase.rpc("get_my_stay").maybeSingle();
    if (!error && data) profile = { ...profile, check_in: data.check_in, check_out: data.check_out };
  }

  // Shown in the UI only — permissions are always decided by the database.
  $("#headerNickname").textContent = profile.role === "admin" ? `${profile.nickname} · 운영자` : profile.nickname;
  $("#headerAvatar").outerHTML = avatarHtml(profile.nickname, "avatar--sm", profile.avatar_url);

  storage.set(SIGNED_IN, "1");
  show("app");
  initOnlinePresence(profile);
  watchStay();
  const header = $(".topbar");
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => document.documentElement.style.setProperty("--measured-topbar-h", `${header.getBoundingClientRect().height}px`)).observe(header);
  }
  setupAutoHideHeader();
  setupPullToRefresh();
  initOperatorAccounts(profile);
  $("#settingsTab").hidden = profile.role !== "admin";
  if (profile.role === "admin") {
    document.addEventListener("section-change", ({ detail }) => {
      if (detail === "settings") renderTermsSettings($("#communityTermsSettings"));
    });
  }
  let checkingConsent = false;
  const recheckConsent = async () => {
    if (document.hidden || checkingConsent) return;
    checkingConsent = true;
    try { await ensureCommunityConsent(); }
    finally { checkingConsent = false; }
  };
  document.addEventListener("visibilitychange", recheckConsent);
  setInterval(recheckConsent, 60000);
  watchSessionActivity();
  setupSectionNav(profile);
  initNews(profile);
  initChat(profile);
  await Promise.all([initGuestbook(profile), initCommunity(profile), initNotifications()]);
  document.addEventListener("operator-account-deleted", () => { scheduleFeedRefresh(); scheduleCommunityRefresh(); });
  subscribeRealtime();
}

// One channel for the other tables (chat subscribes on its own in chat.js). Events are only a "something changed" signal —
// we re-fetch through the normal RLS-protected queries.
function subscribeRealtime() {
  supabase
    .channel("wegoinn-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, scheduleFeedRefresh)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, scheduleNewPosts)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "communities" }, scheduleNewCommunities)
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, scheduleFeedRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "community_comments" }, scheduleCommunityRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "communities" }, scheduleCommunityRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "community_applications" }, scheduleCommunityRefresh)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, refreshNotifications)
    .subscribe();
}

// Scrolling down slides the top bar and section tabs out of view for a bigger screen; scrolling up brings them back.
function setupAutoHideHeader() {
  const root = document.documentElement;
  const chrome = [$(".topbar"), $(".section-nav")];
  const THRESHOLD = 8; // ignore tiny jitters (and momentum wobble) in either direction
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => {
      const height = chrome.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
      root.style.setProperty("--chrome-h", `${height}px`);
    });
    chrome.forEach((el) => observer.observe(el));
  }
  let lastY = window.scrollY;
  let ticking = false;
  const update = () => {
    ticking = false;
    const y = window.scrollY;
    // Sheets and the fullscreen mobile chat lock the page; leave the bars as they are.
    if (root.classList.contains("sheet-open") || root.classList.contains("chat-fullscreen")) { lastY = y; return; }
    if (y < 40) root.classList.remove("chrome-hidden");
    else if (y - lastY > THRESHOLD) root.classList.add("chrome-hidden");
    else if (lastY - y > THRESHOLD) root.classList.remove("chrome-hidden");
    else return; // keep lastY until the movement passes the threshold
    lastY = y;
  };
  window.addEventListener("scroll", () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  // Keyboard focus moving into the bars (Tab) brings them back.
  chrome.forEach((el) => el.addEventListener("focusin", () => root.classList.remove("chrome-hidden")));
}

// Pulling down past the top of the page (touch) reloads it, like a native app.
function setupPullToRefresh() {
  const root = document.documentElement;
  const TRIGGER = 80; // px of pull (after resistance) needed to reload
  const indicator = document.createElement("div");
  indicator.className = "pull-refresh";
  indicator.setAttribute("aria-hidden", "true");
  indicator.innerHTML = icon("refresh");
  document.body.append(indicator);
  let startY = null;
  let pull = 0;
  const reset = () => {
    startY = null;
    pull = 0;
    indicator.classList.remove("is-pulling", "is-ready");
    indicator.style.removeProperty("--pull");
    indicator.style.removeProperty("--pull-turn");
  };
  // A touch inside a scrolled box (a list, a textarea) scrolls that box, not the page.
  const insideScrolledBox = (el) => {
    for (; el && el !== document.body; el = el.parentElement) if (el.scrollTop > 0) return true;
    return false;
  };
  document.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || window.scrollY > 0 || root.classList.contains("sheet-open")
      || root.classList.contains("chat-fullscreen") || insideScrolledBox(event.target)) return;
    startY = event.touches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchmove", (event) => {
    if (startY === null) return;
    const distance = event.touches[0].clientY - startY;
    if (distance <= 0 || window.scrollY > 0) { reset(); return; }
    pull = Math.min(distance * 0.5, TRIGGER * 1.5);
    indicator.classList.add("is-pulling");
    indicator.classList.toggle("is-ready", pull >= TRIGGER);
    indicator.style.setProperty("--pull", `${pull}px`);
    indicator.style.setProperty("--pull-turn", `${pull * 3}deg`);
  }, { passive: true });
  document.addEventListener("touchend", () => {
    if (startY === null) return;
    if (pull >= TRIGGER) {
      indicator.classList.add("is-refreshing");
      location.reload();
      return;
    }
    reset();
  });
  document.addEventListener("touchcancel", reset);
}

// Community / 방명록 / Chat are separate pages: the tab (and the URL hash) decides which one is shown.
// Links elsewhere can switch pages with location.hash = "chat" etc.
function setupSectionNav(profile) {
  const links = $$(".section-nav a").filter(a => !a.hidden);
  const sections = $$("[data-section]").filter(s => !s.dataset.operatorOnly || profile.role === "admin");
  const ids = sections.map((s) => s.id);
  const showSection = (id, { scroll = true } = {}) => {
    if (!ids.includes(id)) id = ids[0];
    sections.forEach((s) => (s.hidden = s.id !== id));
    links.forEach((a) => {
      const active = a.getAttribute("href") === `#${id}`;
      a.classList.toggle("is-active", active);
      if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.documentElement.classList.remove("chrome-hidden");
    if (scroll) window.scrollTo({ top: 0 });
    sectionInView(id);
    document.dispatchEvent(new CustomEvent("section-change", { detail: id }));
  };
  links.forEach((a) => a.addEventListener("click", (event) => {
    event.preventDefault();
    const id = a.getAttribute("href").slice(1);
    if (location.hash === `#${id}`) showSection(id);
    else location.hash = id; // hashchange shows it, and Back returns to the previous page
  }));
  window.addEventListener("hashchange", () => showSection(location.hash.slice(1)));
  showSection(location.hash.slice(1), { scroll: false });
}

supabase?.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") location.reload();
});

boot().catch((err) => {
  toast(errorMessage(err), "error");
  show("login");
});

