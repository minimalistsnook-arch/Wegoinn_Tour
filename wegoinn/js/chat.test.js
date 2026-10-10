import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const mock = vi.hoisted(() => ({ mobile: false, rows: [], inserted: null, query: [], subscribed: null }));
vi.mock('./supabase.js', () => {
  const chain = () => {
    const c = {};
    for (const op of ['select', 'is', 'eq', 'gte', 'order', 'delete']) c[op] = vi.fn((...args) => { mock.query.push([op, ...args]); return c; });
    c.limit = vi.fn(() => c);
    c.insert = vi.fn((row) => { mock.inserted = row; return c; });
    c.single = vi.fn(async () => ({ data: { id: 'm-new', author_id: 'me', created_at: '2026-10-09T10:00:00Z', author: { nickname: 'Mina' }, ...mock.inserted }, error: null }));
    c.maybeSingle = vi.fn(async () => ({ data: { nickname: 'Emma' }, error: null }));
    c.then = (resolve, reject) => Promise.resolve({ data: [...mock.rows], error: null }).then(resolve, reject);
    return c;
  };
  const channel = { on: vi.fn(() => channel), subscribe: vi.fn((cb) => { mock.subscribed = cb; return channel; }), track: vi.fn(), presenceState: () => ({}) };
  return { supabase: { from: vi.fn(chain), channel: vi.fn(() => channel), removeChannel: vi.fn() }, errorMessage: (err) => err.message };
});
import { initChat, openChat, onChatInsert, onChatDelete } from './chat.js';
const html = readFileSync(`${process.cwd()}/wegoinn/index.html`, 'utf8');
const settle = () => new Promise((r) => setTimeout(r, 20));
const me = { id: 'me', nickname: 'Mina' };

let viewport;
beforeEach(async () => {
  mock.mobile = false;
  vi.stubGlobal('matchMedia', () => ({ get matches() { return mock.mobile; } }));
  vi.stubGlobal('requestAnimationFrame', callback => { callback(); return 1; });
  viewport = new EventTarget();
  viewport.height = 740;
  viewport.offsetTop = 0;
  vi.stubGlobal('visualViewport', viewport);
  document.documentElement.classList.remove('chat-fullscreen');
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

  it('shows a message from another guest in the open room right away, once', async () => {
    const row = { id: 'm5', community_id: null, author_id: 'u2', content: 'Live!', created_at: '2026-10-09T11:00:00Z' };
    await onChatInsert({ new: row });
    await onChatInsert({ new: row });
    expect(document.querySelectorAll('[data-msg-id="m5"]')).toHaveLength(1);
    expect(document.querySelector('[data-msg-id="m5"] .chat-msg__text').textContent).toBe('Live!');
  });

  it('catches up on missed messages after (re)subscribing without duplicates', async () => {
    mock.rows = [
      { id: 'm1', community_id: null, author_id: 'u2', content: 'Anyone going to Hongdae? <b>', created_at: '2026-10-09T09:00:00Z', author: { nickname: 'Emma' } },
      { id: 'm6', community_id: null, author_id: 'u3', content: 'missed while offline', created_at: '2026-10-09T12:00:00Z', author: { nickname: 'Leo' } },
    ];
    mock.query = [];
    mock.subscribed('SUBSCRIBED');
    await settle();
    expect(mock.query).toContainEqual(['gte', 'created_at', '2026-10-09T09:00:00Z']);
    expect(document.querySelectorAll('[data-msg-id="m1"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-msg-id="m6"]')).toHaveLength(1);
  });

  it('keeps messages that arrive while a room is still loading', async () => {
    const opening = openChat({ id: 'c1', title: 'Night Walk' });
    await onChatInsert({ new: { id: 'm7', community_id: 'c1', author_id: 'u2', content: 'early', created_at: '2026-10-09T13:00:00Z' } });
    await opening;
    expect(document.querySelectorAll('[data-msg-id="m7"]')).toHaveLength(1);
  });
});

afterEach(() => { document.querySelector('#chatCloseFullscreen').click(); vi.unstubAllGlobals(); });
it('fits mobile chat to the keyboard viewport and returns to the page with its draft', () => {
  mock.mobile = true;
  const input = document.querySelector('#chatInput');
  const chat = document.querySelector('#chat');
  input.focus();
  expect(chat.classList.contains('is-fullscreen')).toBe(true);
  expect(document.documentElement.classList.contains('chat-fullscreen')).toBe(true);
  expect(document.querySelector('#chatCloseFullscreen').hidden).toBe(false);
  input.value = 'Draft';
  viewport.height = 390; viewport.offsetTop = 12;
  viewport.dispatchEvent(new Event('resize'));
  expect(chat.style.getPropertyValue('--chat-viewport-height')).toBe('390px');
  expect(chat.style.getPropertyValue('--chat-viewport-top')).toBe('12px');
  document.querySelector('#chatCloseFullscreen').click();
  expect(chat.classList.contains('is-fullscreen')).toBe(false);
  expect(document.documentElement.classList.contains('chat-fullscreen')).toBe(false);
  expect(chat.style.getPropertyValue('--chat-viewport-height')).toBe('');
  expect(input.value).toBe('Draft');
});
it('keeps the fullscreen conversation and keyboard focus after sending', async () => {
  mock.mobile = true;
  const input = document.querySelector('#chatInput');
  input.focus(); input.value = 'Hello'; input.dispatchEvent(new Event('input'));
  document.querySelector('#chatForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(mock.inserted).toMatchObject({ content: 'Hello' });
  expect(document.querySelector('#chatMessages').textContent).toContain('Hello');
  expect(document.querySelector('#chat').classList.contains('is-fullscreen')).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('');
});
it('keeps desktop chat inline and exits fullscreen when the viewport becomes wider', () => {
  mock.mobile = true;
  const input = document.querySelector('#chatInput');
  mock.mobile = false; input.focus();
  expect(document.querySelector('#chat').classList.contains('is-fullscreen')).toBe(false);
  input.blur(); mock.mobile = true; input.focus();
  expect(document.querySelector('#chat').classList.contains('is-fullscreen')).toBe(true);
  mock.mobile = false; window.dispatchEvent(new Event('resize'));
  expect(document.querySelector('#chat').classList.contains('is-fullscreen')).toBe(false);
});
