import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const mock = vi.hoisted(() => ({ rows: [], inserted: null, query: [] }));
vi.mock('./supabase.js', () => {
  const chain = () => {
    const c = {};
    for (const op of ['select', 'is', 'eq', 'order', 'delete']) c[op] = vi.fn((...args) => { mock.query.push([op, ...args]); return c; });
    c.limit = vi.fn(() => c);
    c.insert = vi.fn((row) => { mock.inserted = row; return c; });
    c.single = vi.fn(async () => ({ data: { id: 'm-new', author_id: 'me', created_at: '2026-10-09T10:00:00Z', author: { nickname: 'Mina' }, ...mock.inserted }, error: null }));
    c.maybeSingle = vi.fn(async () => ({ data: { nickname: 'Emma' }, error: null }));
    c.then = (resolve, reject) => Promise.resolve({ data: [...mock.rows], error: null }).then(resolve, reject);
    return c;
  };
  const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel), track: vi.fn(), presenceState: () => ({}) };
  return { supabase: { from: vi.fn(chain), channel: vi.fn(() => channel) }, errorMessage: (err) => err.message };
});
import { initChat, openChat, onChatInsert, onChatDelete } from './chat.js';
const html = readFileSync(`${process.cwd()}/wegoinn/index.html`, 'utf8');
const settle = () => new Promise((r) => setTimeout(r, 20));
const me = { id: 'me', nickname: 'Mina' };

beforeEach(async () => {
  Element.prototype.scrollIntoView = () => {};
  document.documentElement.innerHTML = html.replace(/<!DOCTYPE html>/i, '').replace(/<\/?html[^>]*>/g, '');
  mock.rows = [{ id: 'm1', community_id: null, author_id: 'u2', content: 'Anyone going to Hongdae? <b>', created_at: '2026-10-09T09:00:00Z', author: { nickname: 'Emma' } }];
  mock.query = []; mock.inserted = null;
  await initChat(me);
});

describe('live chat', () => {
  it('shows Global Chat in the page on load with escaped content and only my delete buttons', async () => {
    expect(document.querySelector('#chat #chatMessages')).not.toBeNull();
    expect(document.querySelector('.section-nav a[href="#chat"]')).not.toBeNull();
    expect(mock.query).toContainEqual(['is', 'community_id', null]);
    const msg = document.querySelector('[data-msg-id="m1"]');
    expect(msg.querySelector('.chat-msg__text').textContent).toBe('Anyone going to Hongdae? <b>');
    expect(msg.querySelector('[data-delete-msg]')).toBeNull();
    expect(document.getElementById('chatTitle').textContent).toBe('Global Chat');
  });

  it('sends into the open community room and ignores the echoed realtime event', async () => {
    await openChat({ id: 'c1', title: 'Night Walk' });
    expect(mock.query).toContainEqual(['eq', 'community_id', 'c1']);
    expect(document.getElementById('chatBackBtn').hidden).toBe(false);
    document.getElementById('chatInput').value = 'See you at 8!';
    document.getElementById('chatForm').requestSubmit();
    await settle();
    expect(mock.inserted).toMatchObject({ community_id: 'c1', content: 'See you at 8!' });
    await onChatInsert({ new: { id: 'm-new', community_id: 'c1', author_id: 'me', content: 'See you at 8!', created_at: '2026-10-09T10:00:00Z' } });
    expect(document.querySelectorAll('[data-msg-id="m-new"]')).toHaveLength(1);
    expect(document.querySelector('[data-msg-id="m-new"] [data-delete-msg]')).not.toBeNull();
  });

  it('counts unread global messages while in a group room and removes deleted ones', async () => {
    await openChat({ id: 'c1', title: 'Night Walk' });
    await onChatInsert({ new: { id: 'm2', community_id: null, author_id: 'u2', content: 'hi', created_at: '2026-10-09T10:00:00Z' } });
    await onChatInsert({ new: { id: 'm3', community_id: 'c9', author_id: 'u2', content: 'room', created_at: '2026-10-09T10:00:00Z' } });
    expect(document.getElementById('chatUnread').textContent).toBe('1');
    document.getElementById('chatBackBtn').click();
    await settle();
    expect(document.getElementById('chatUnread').hidden).toBe(true);
    expect(document.getElementById('chatBackBtn').hidden).toBe(true);
    onChatDelete({ old: { id: 'm1' } });
    expect(document.querySelector('[data-msg-id="m1"]')).toBeNull();
  });
});
