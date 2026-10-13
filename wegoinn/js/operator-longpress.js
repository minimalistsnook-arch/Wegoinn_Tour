import { openSheet, closeSheet } from './sheet.js';
import { accountSummary } from './operator-accounts.js';
const installed = new WeakMap();
export function installOperatorLongPress(root, me, selector, actions) {
 installed.get(root)?.();
 if (!root || me?.role !== 'admin') return;
 let timer, target, start, suppressedUntil = 0, suppressedTarget;
 const cancel = () => { clearTimeout(timer); timer = null; };
 const show = element => {
  const sheet = document.getElementById('operatorActionsSheet');
  if (!sheet) return;
  const info = actions(element);
  if (!info) return;
  sheet.querySelector('[data-operator-summary]').textContent = accountSummary(info.authorId) || info.title || '운영자 관리';
  for (const kind of ['edit', 'delete']) sheet.querySelector(`[data-operator-${kind}]`).onclick = () => {
   closeSheet('operatorActionsSheet'); info[kind]?.();
  };
  openSheet('operatorActionsSheet');
 };
 const down = event => {
  cancel();
  if (!['touch', 'pen'].includes(event.pointerType) || event.isPrimary === false || event.target.closest('input,textarea,select,a,[contenteditable]')) return;
  target = event.target.closest(selector);
  if (!target || !root.contains(target)) return;
  start = { x: event.clientX, y: event.clientY };
  timer = setTimeout(() => {
   suppressedTarget = target; suppressedUntil = Date.now() + 1200;
   show(target);
  }, 550);
 };
 const move = event => { if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel(); };
 const click = event => {
  if (event.isTrusted && Date.now() < suppressedUntil && suppressedTarget?.contains(event.target)) {
   event.preventDefault(); event.stopImmediatePropagation(); suppressedUntil = 0;
  }
 };
 const context = event => { if (event.target.closest(selector)) event.preventDefault(); };
 root.addEventListener('pointerdown', down);
 root.addEventListener('pointermove', move);
 root.addEventListener('click', click, true);
 root.addEventListener('contextmenu', context);
 window.addEventListener('pointerup', cancel);
 window.addEventListener('pointercancel', cancel);
 window.addEventListener('scroll', cancel, true);
 installed.set(root, () => {
  cancel(); root.removeEventListener('pointerdown', down); root.removeEventListener('pointermove', move);
  root.removeEventListener('click', click, true); root.removeEventListener('contextmenu', context);
  window.removeEventListener('pointerup', cancel); window.removeEventListener('pointercancel', cancel); window.removeEventListener('scroll', cancel, true);
 });
}
