import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ count: 0, calls: [] }));
vi.mock('./supabase.js', () => ({ supabase: { from: vi.fn((table) => {
  const chain = {};
  for (const op of ['select', 'gt', 'neq']) chain[op] = vi.fn((...args) => { mock.calls.push([table, op, ...args]); return chain; });
  chain.then = (resolve, reject) => Promise.resolve({ count: mock.count, error: null }).then(resolve, reject);
  return chain;
}) } }));
import { initNews, isNew, sectionInView } from './news.js';
const me = { id: 'me' };
beforeEach(() => {
  localStorage.clear(); mock.calls = [];
  document.body.innerHTML = '<span id="communityNew" hidden></span><span id="guestbookNew" hidden></span>';
});
describe('new markers', () => {
  it('counts items by other guests since the last visit and clears once the section is seen', async () => {
    localStorage.setItem('wegoinn-seen-community-me', '2026-10-01T00:00:00.000Z');
    mock.count = 3;
    vi.useFakeTimers();
    await initNews(me);
    const badge = document.getElementById('communityNew');
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('3');
    expect(mock.calls).toContainEqual(['communities', 'neq', 'creator_id', 'me']);
    expect(isNew('community', '2026-10-02T00:00:00Z', 'u2')).toBe(true);
    expect(isNew('community', '2026-10-02T00:00:00Z', 'me')).toBe(false);
    sectionInView('community');
    vi.advanceTimersByTime(1500);
    expect(badge.hidden).toBe(true);
    expect(localStorage.getItem('wegoinn-seen-community-me') > '2026-10-01').toBe(true);
    vi.useRealTimers();
  });
});
