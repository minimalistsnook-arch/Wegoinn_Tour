import { supabase, errorMessage } from "./supabase.js";
import { isSupabaseConfigured } from "./config.js";
import { signInGuest, getMyProfile } from "./auth.js";
import { initGuestbook, scheduleFeedRefresh } from "./guestbook.js";
import { initCommunity, scheduleCommunityRefresh } from "./community.js";
import { $, $$, avatarHtml, toast, setBusy } from "./utils.js";
import { hydrateIcons } from "./icons.js";

hydrateIcons();

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

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const reservation = form.elements.reservation;
  const nickname = form.elements.nickname;
  if (!reservation.value.trim() || !nickname.value.trim()) {
    return toast("Please enter your reservation number and nickname.", "error");
  }
  const button = form.querySelector('[type="submit"]');
  setBusy(button, true, "Entering…");
  try {
    const profile = await signInGuest(reservation.value, nickname.value);
    reservation.value = ""; // don't leave the reservation number in the DOM
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
  $("#headerAvatar").outerHTML = avatarHtml(profile.nickname, "avatar--sm");
  $("#greetingName").textContent = profile.nickname;

  show("app");
  setupSectionNav();
  await Promise.all([initGuestbook(profile), initCommunity(profile)]);
  subscribeRealtime();
}

// One channel, four tables. Events are only a "something changed" signal —
// we re-fetch through the normal RLS-protected queries.
function subscribeRealtime() {
  supabase
    .channel("wegoinn-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, scheduleFeedRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, scheduleFeedRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "communities" }, scheduleCommunityRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "community_applications" }, scheduleCommunityRefresh)
    .subscribe();
}

// Guestbook / Community pills highlight the section in view.
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

