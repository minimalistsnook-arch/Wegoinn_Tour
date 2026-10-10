import { CONFIG } from "./config.js";
export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function initials(name = "?") {
  return (name.trim()[0] || "?").toUpperCase();
}

// Stable soft colour per nickname, so the same guest always looks the same.
const AVATAR_TONES = ["rose", "peach", "lilac", "sage", "sand", "sky"];
export function avatarTone(name = "") {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function avatarHtml(name, size = "", photoUrl = "") {
  if (photoUrl?.startsWith("https://")) {
    return `<span class="avatar avatar--${avatarTone(name)} avatar--photo ${size}" aria-hidden="true"><img src="${escapeHtml(photoUrl)}" alt="" loading="lazy" decoding="async" /></span>`;
  }
  return `<span class="avatar avatar--${avatarTone(name)} ${size}" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
}

export function formatDate(iso) {
  return new Intl.DateTimeFormat(displayLocale(), { month: "short", day: "numeric", year: "numeric", timeZone: CONFIG.HOSTEL_TIME_ZONE }).format(new Date(iso));
}

export function formatTime(iso) {
  return new Intl.DateTimeFormat(displayLocale(), { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: CONFIG.HOSTEL_TIME_ZONE }).format(new Date(iso));
}

export function formatDateTime(iso) {
  return `${formatDate(iso)} · ${formatTime(iso)} KST`;
}

// "2026-10-12" → Date at local midnight (no UTC shift).
export function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDateKey(key, opts = { weekday: "short", month: "long", day: "numeric" }) {
  return new Intl.DateTimeFormat(displayLocale(), opts).format(parseDateKey(key));
}

// "19:30:00" → "19:30"
export const shortTime = (t = "") => t.slice(0, 5);

export function formatFee(amount) {
  return Number(amount) > 0 ? `₩${Number(amount).toLocaleString("ko-KR")}` : "FREE";
}

let toastTimer;
export function toast(message, tone = "") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${tone ? `toast--${tone}` : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

export function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function setBusy(button, busy, busyLabel = "…") {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.innerHTML = busyLabel;
    button.disabled = true;
  } else {
    if (button.dataset.label) button.innerHTML = button.dataset.label;
    button.disabled = false;
  }
}

export function koreaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: CONFIG.HOSTEL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (key) => parts.find((p) => p.type === key).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function communityIsLocked(c, now = Date.now()) {
  if (!c) return true;
  const start = new Date(`${c.community_date}T${c.community_time}+09:00`).getTime();
  return c.status === "cancelled" || !Number.isFinite(start) || start <= now;
}
export function safeMapUrl(value) {
  if (!value) return "";
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}

export function displayLocale() { return ({ en: "en", ko: "ko-KR", ja: "ja-JP", zh: "zh-CN" })[localStorage.getItem("wegoinn-language") || "en"] || "en"; }
