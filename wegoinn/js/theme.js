const KEY = "wegoinn-theme";

function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

function paintToggles() {
  const dark = isDark();
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(dark));
    btn.textContent = dark ? "Light" : "Dark";
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#161311" : "#f3ecdf");
}

export function initTheme() {
  paintToggles();
  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-theme-toggle]");
    if (!btn) return;
    const next = isDark() ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode */
    }
    if (next === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    paintToggles();
  });
}
