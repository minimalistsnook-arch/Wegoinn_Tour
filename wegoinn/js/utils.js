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

export function avatarHtml(name, size = "") {
  return `<span class="avatar avatar--${avatarTone(name)} ${size}" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
}

export function formatDate(iso) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

export function formatTime(iso) {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function formatDateTime(iso) {
  return `${formatDate(iso)} · ${formatTime(iso)}`;
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
  return new Intl.DateTimeFormat("en", opts).format(parseDateKey(key));
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
