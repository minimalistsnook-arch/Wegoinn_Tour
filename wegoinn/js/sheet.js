// Bottom sheet on phones, centred dialog on larger screens.
const onCloseHandlers = new Map();
let lastFocus = null;

export function openSheet(id, onClose) {
  const sheet = document.getElementById(id);
  if (!sheet) return;
  lastFocus = document.activeElement;
  if (onClose) onCloseHandlers.set(id, onClose);
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

document.addEventListener("click", (event) => {
  const closer = event.target.closest("[data-close-sheet]");
  if (closer) closeSheet(closer.closest(".sheet").id);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const open = [...document.querySelectorAll(".sheet.is-open")].pop();
  if (open) closeSheet(open.id);
});
