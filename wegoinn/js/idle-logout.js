// Signs a guest out after 20 minutes away: no tap, typing or scrolling, or the app left closed.
// The last activity time is kept in localStorage so it survives closing the tab and is shared by open tabs.
const IDLE_LIMIT = 20 * 60 * 1000;
const LAST_ACTIVE = "wegoinn-last-active";
export const IDLE_MESSAGE = "20분 동안 사용하지 않아 자동으로 로그아웃되었습니다.";

const readLast = () => { try { return Number(localStorage.getItem(LAST_ACTIVE)) || 0; } catch { return 0; } };
const writeLast = (value) => { try { value ? localStorage.setItem(LAST_ACTIVE, String(value)) : localStorage.removeItem(LAST_ACTIVE); } catch { /* private mode */ } };

export const idleExpired = () => { const last = readLast(); return last > 0 && Date.now() - last > IDLE_LIMIT; };
export const clearIdle = () => writeLast(0);

export function watchIdle(onIdle) {
  let marked = 0;
  const mark = (force) => {
    const now = Date.now();
    if (!force && now - marked < 15000) return; // at most one write every 15 s
    marked = now;
    writeLast(now);
  };
  const check = () => {
    if (!idleExpired()) return false;
    onIdle();
    return true;
  };
  mark(true);
  for (const type of ["pointerdown", "keydown", "touchstart", "wheel"]) document.addEventListener(type, () => mark(), { passive: true, capture: true });
  document.addEventListener("scroll", () => mark(), { passive: true, capture: true });
  // Coming back to the app: check first, so the time away is not counted as activity.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !check()) mark(true);
  });
  setInterval(check, 60 * 1000);
}
