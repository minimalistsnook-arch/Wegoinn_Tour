import { initSiteLanguage } from "./i18n.js";
import { initNotifications, refreshNotifications } from "./notifications.js";
import { supabase, errorMessage } from "./supabase.js";
import { isSupabaseConfigured } from "./config.js";
import { signInGuest, getMyProfile, normalizeStayDate } from "./auth.js";
import { compressAvatar } from "./image-upload.js";
import { initGuestbook, scheduleFeedRefresh } from "./guestbook.js";
import { initCommunity, scheduleCommunityRefresh } from "./community.js";
import { initNews, sectionInView, scheduleNewCommunities, scheduleNewPosts } from "./news.js";
import { initChat } from "./chat.js";
import { $, $$, avatarHtml, toast, setBusy } from "./utils.js";
import { hydrateIcons } from "./icons.js";
import { initTheme } from "./theme.js";
import { loginErrorMessage } from "./login-errors.js";

hydrateIcons();
initTheme();
initSiteLanguage();
$("#logoutBtn").addEventListener("click", async () => {
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
  } catch (err) {
    console.warn(err);
  }
  show("login");
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
  input.addEventListener("input", syncCalendar);
  input.addEventListener("click", openCalendar);
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
  started = true;

  // Shown in the UI only — permissions are always decided by the database.
  $("#headerNickname").textContent = profile.role === "admin" ? `${profile.nickname} · 운영자` : profile.nickname;
  $("#headerAvatar").outerHTML = avatarHtml(profile.nickname, "avatar--sm", profile.avatar_url);
  $("#greetingName").textContent = profile.nickname;

  show("app");
  const header = $(".topbar");
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => document.documentElement.style.setProperty("--measured-topbar-h", `${header.getBoundingClientRect().height}px`)).observe(header);
  }
  setupAutoHideHeader();
  setupSectionNav();
  initNews(profile);
  initChat(profile);
  await Promise.all([initGuestbook(profile), initCommunity(profile), initNotifications()]);
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

// Guestbook / Community / Chat pills highlight the section in view.
function setupSectionNav() {
  const links = $$(".section-nav a");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === `#${entry.target.id}`));
        sectionInView(entry.target.id);
      });
    },
    { rootMargin: "-45% 0px -50% 0px" }
  );
  $$("[data-section]").forEach((s) => observer.observe(s));
}

supabase?.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") location.reload();
});

boot().catch((err) => {
  toast(errorMessage(err), "error");
  show("login");
});

