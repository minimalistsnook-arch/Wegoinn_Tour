// Bottom sheet on phones, centred dialog on larger screens.
const onCloseHandlers = new Map();
let lastFocus = null;

export function openSheet(id, onClose) {
  const sheet = document.getElementById(id);
  if (!sheet) return;
  lastFocus = document.activeElement;
  if (onClose) onCloseHandlers.set(id, onClose);
  // A history entry per sheet, so the phone/browser Back button closes the sheet instead of leaving the page.
  if (sheet.hidden && history.state?.sheet !== id) history.pushState({ ...history.state, sheet: id }, "");
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add("is-open"));
  document.documentElement.classList.add("sheet-open");
  sheet.querySelector(".sheet__panel")?.focus({ preventScroll: true });
}

export function closeSheet(id) {
  const sheet = document.getElementById(id);
  if (!sheet || sheet.hidden) return;
  sheet.classList.remove("is-open");
  setTimeout(() => {
    sheet.hidden = true;
    if (!document.querySelector(".sheet.is-open")) document.documentElement.classList.remove("sheet-open");
  }, 260);
  onCloseHandlers.get(id)?.();
  onCloseHandlers.delete(id);
  if (!document.querySelector(".sheet.is-open")) lastFocus?.focus?.({ preventScroll: true });
}

// Closed by the guest (×, backdrop, Escape, swipe): also drop the sheet's history entry so the next Back leaves the page as usual.
// Sheets closed from code keep theirs (a later Back then just stays on the page) so the pop can't close a sheet opened next.
function dismissSheet(id) {
  closeSheet(id);
  if (history.state?.sheet === id) history.back();
}

// Back: slide the top sheet down and stay on the Community / 방명록 page underneath.
window.addEventListener("popstate", () => {
  const top = [...document.querySelectorAll(".sheet.is-open")].pop();
  if (top && top.id !== history.state?.sheet) closeSheet(top.id);
});

document.addEventListener("click", (event) => {
  const closer = event.target.closest("[data-close-sheet]");
  if (closer) dismissSheet(closer.closest(".sheet").id);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const open = [...document.querySelectorAll(".sheet.is-open")].pop();
  if (open) dismissSheet(open.id);
});

// Phones: dragging an open sheet down from its top closes it, back to the page underneath.
const CLOSE_DISTANCE = 100;
const phoneSheet = window.matchMedia("(max-width: 639px)");
let drag = null;

document.addEventListener("touchstart", (event) => {
  drag = null;
  const panel = event.target.closest?.(".sheet.is-open .sheet__panel");
  if (!panel || !phoneSheet.matches || event.touches.length !== 1) return;
  if (event.target.closest("input, textarea, select, [contenteditable]")) return;
  // Only from the top: a scrolled sheet (or a scrolled box inside it) scrolls up first.
  for (let el = event.target; el && el !== panel.parentElement; el = el.parentElement) if (el.scrollTop > 0) return;
  drag = { sheet: panel.closest(".sheet"), x: event.touches[0].clientX, y: event.touches[0].clientY, dy: 0 };
}, { passive: true });

document.addEventListener("touchmove", (event) => {
  if (!drag) return;
  const dx = event.touches[0].clientX - drag.x;
  const dy = event.touches[0].clientY - drag.y;
  if (!drag.dy && (dy <= 0 || Math.abs(dx) > Math.abs(dy))) { drag = null; return; } // a scroll up or a sideways swipe
  if (event.cancelable) event.preventDefault();
  drag.dy = Math.max(0, dy);
  drag.sheet.classList.add("is-dragging");
  drag.sheet.style.setProperty("--sheet-drag", `${drag.dy}px`);
}, { passive: false });

function endDrag() {
  if (!drag) return;
  const { sheet, dy } = drag;
  drag = null;
  sheet.classList.remove("is-dragging");
  if (dy >= CLOSE_DISTANCE) {
    dismissSheet(sheet.id);
    setTimeout(() => sheet.style.removeProperty("--sheet-drag"), 300); // after the slide-out
  } else {
    sheet.style.removeProperty("--sheet-drag");
  }
}
document.addEventListener("touchend", endDrag);
document.addEventListener("touchcancel", endDrag);
