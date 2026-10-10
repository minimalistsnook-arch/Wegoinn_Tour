import { initSiteLanguage } from "./i18n.js";
import { initNotifications, refreshNotifications } from "./notifications.js";
import { supabase, errorMessage } from "./supabase.js";
import { isSupabaseConfigured } from "./config.js";
import { signInGuest, getMyProfile } from "./auth.js";
import { compressAvatar } from "./image-upload.js";
import { initGuestbook, scheduleFeedRefresh } from "./guestbook.js";
import { initCommunity, scheduleCommunityRefresh } from "./community.js";
import { initChat } from "./chat.js";
import { $, $$, avatarHtml, toast, setBusy } from "./utils.js";
import { hydrateIcons } from "./icons.js";
import { initTheme } from "./theme.js";

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
  const reservation = form.elements.reservation;
  const nickname = form.elements.nickname;
  if (!reservation.value.trim() || !nickname.value.trim()) {
    return toast("Please enter the reservation name or number and a nickname.", "error");
  }
  const button = form.querySelector('[type="submit"]');
  setBusy(button, true, "Entering…");
  try {
    const profile = await signInGuest(reservation.value, nickname.value, avatarFile);
    reservation.value = ""; // don't leave the reservation number in the DOM
    setAvatar(null);
    await enterApp(profile);
  } catch (err) {
    toast(errorMessage(err), "error");
  } finally {
    setBusy(button, false);
  }
});

let started = false;

async function enterApp(profile) {
  if (started) return;
  started = true;

  // Shown in the UI only — permissions are always decided by the database.
  $("#headerNickname").textContent = profile.nickname;
  $("#headerAvatar").outerHTML = avatarHtml(profile.nickname, "avatar--sm", profile.avatar_url);
  $("#greetingName").textContent = profile.nickname;

  show("app");
  const header = $(".topbar");
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => document.documentElement.style.setProperty("--measured-topbar-h", `${header.getBoundingClientRect().height}px`)).observe(header);
  }
  setupSectionNav();
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
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, scheduleFeedRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "communities" }, scheduleCommunityRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "community_applications" }, scheduleCommunityRefresh)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, refreshNotifications)
    .subscribe();
}

// Guestbook / Community / Chat pills highlight the section in view.
function setupSectionNav() {
  const links = $$(".section-nav a");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === `#${entry.target.id}`));
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

