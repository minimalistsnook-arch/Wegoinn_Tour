import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const mock = vi.hoisted(() => ({ mobile: false, rows: [], inserted: null, query: [], subscribed: null, rpc:vi.fn() }));
vi.mock('./supabase.js', () => {
  const chain = () => {
    const c = {};
    for (const op of ['select', 'is', 'eq', 'gte', 'order', 'delete', 'or']) c[op] = vi.fn((...args) => { mock.query.push([op, ...args]); return c; });
    c.limit = vi.fn(() => c);
    c.insert = vi.fn((row) => { mock.inserted = row; return c; });
    c.single = vi.fn(async () => ({ data: { id: 'm-new', author_id: 'me', created_at: '2026-10-09T10:00:00Z', author: { nickname: 'Mina' }, ...mock.inserted }, error: null }));
    c.maybeSingle = vi.fn(async () => ({ data: { nickname: 'Emma' }, error: null }));
    c.then = (resolve, reject) => Promise.resolve({ data: [...mock.rows], error: null }).then(resolve, reject);
    return c;
  };
  const channel = { on: vi.fn(() => channel), subscribe: vi.fn((cb) => { mock.subscribed = cb; return channel; }), track: vi.fn(), presenceState: () => ({}) };
  return { supabase: { rpc: mock.rpc, from: vi.fn(chain), channel: vi.fn(() => channel), removeChannel: vi.fn() }, errorMessage: (err) => err.message };
});
import { initChat, openChat, onChatInsert, onChatDelete, onChatUpdate, setChatRooms } from './chat.js';
const html = readFileSync(`${process.cwd()}/wegoinn/index.html`, 'utf8');
const settle = () => new Promise((r) => setTimeout(r, 20));
const me = { id: 'me', nickname: 'Mina' };

let viewport;
beforeEach(async () => {
  mock.mobile = false;
  me.role = "guest";
  mock.rpc.mockReset(); mock.rpc.mockResolvedValue({error:null});
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

  it('counts unread messages from other rooms and removes deleted ones', async () => {
    await openChat({ id: 'c1', title: 'Night Walk' });
    await onChatInsert({ new: { id: 'm2', community_id: null, author_id: 'u2', content: 'hi', created_at: '2026-10-09T10:00:00Z' } });
    await onChatInsert({ new: { id: 'm3', community_id: 'c9', author_id: 'u2', content: 'room', created_at: '2026-10-09T10:00:00Z' } });
    expect(document.getElementById('chatUnread').textContent).toBe('2');
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
it('opens chat immediately on entry on desktop and mobile and closes when leaving', () => {
  for (const mobile of [false, true]) {
    mock.mobile = mobile;
    document.dispatchEvent(new CustomEvent('section-change', { detail: 'chat' }));
    expect(document.querySelector('#chat').classList.contains('is-fullscreen')).toBe(true);
    expect(document.activeElement).not.toBe(document.querySelector('#chatInput'));
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.classList.contains('chat-fullscreen')).toBe(true);
    document.dispatchEvent(new CustomEvent('section-change', { detail: 'community' }));
    expect(document.documentElement.classList.contains('chat-fullscreen')).toBe(false);
  }
});

it('lists joined community chats under Live Chat and switches rooms from there', async () => {
  setChatRooms([{ id: 'c-1', title: 'Hongdae walk', date: '2099-01-01', time: '19:00:00' }]);
  const rooms = document.querySelector('#chatRooms');
  expect(rooms.hidden).toBe(false);
  expect(rooms.textContent).toContain('Global Chat');
  expect(rooms.textContent).toContain('Hongdae walk');
  rooms.querySelector('[data-room="c-1"]').click(); await settle();
  expect(document.querySelector('#chatTitle').textContent).toBe('Hongdae walk');
  expect(rooms.querySelector('[data-room="c-1"]').getAttribute('aria-pressed')).toBe('true');
  rooms.querySelector('[data-room=""]').click(); await settle();
  expect(document.querySelector('#chatTitle').textContent).toBe('Global Chat');
  await onChatInsert({ new: { id: 'm9', community_id: 'c-1', author_id: 'u2', content: 'see you', created_at: '2026-10-09T12:00:00Z' } });
  expect(rooms.querySelector('[data-room="c-1"] .chat-room__dot')).not.toBeNull();
  rooms.querySelector('[data-room="c-1"]').click(); await settle();
  expect(rooms.querySelector('[data-room="c-1"] .chat-room__dot')).toBeNull();
});


it("lets an operator edit, delete and reply to another guest's message",async()=>{
 me.role='admin';await openChat();
 expect(document.querySelector('[data-delete-msg="m1"]')).not.toBeNull();
 document.querySelector('[data-edit-msg="m1"]').click();
 const form=document.querySelector('#moderationForm');
 form.elements.content.value='Corrected message';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();
 expect(mock.rpc).toHaveBeenCalledWith('admin_update_content',expect.objectContaining({p_kind:'chat',p_id:'m1',p_content:'Corrected message'}));
 document.querySelector('[data-reply-msg="m1"]').click();
 expect(document.querySelector('#chatReplyContext').hidden).toBe(false);
 document.querySelector('#chatInput').value='Please check with reception.';
 document.querySelector('#chatForm').requestSubmit();await settle();
 expect(mock.inserted.content).toContain('운영자 답글 → Emma');
 expect(mock.inserted.content).toContain('Please check with reception.');
 expect(document.querySelector('#chatReplyContext').hidden).toBe(true);
});

it('reflects message edits received through realtime without changing the author',()=>{
 onChatUpdate({new:{id:'m1',content:'Updated by staff',author_id:'u2'}});
 expect(document.querySelector('[data-msg-id="m1"] .chat-msg__text').textContent).toBe('Updated by staff');
 expect(document.querySelector('[data-msg-id="m1"] strong').textContent).toBe('Emma');
});


it('allows an operator to load and moderate older chat history',async()=>{
 me.role='admin';
 mock.rows=Array.from({length:100},(_,n)=>({id:`m-${String(n).padStart(3,'0')}`,community_id:null,author_id:'u2',content:`Message ${n}`,created_at:`2026-10-09T09:${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}Z`,author:{nickname:'Emma'}}));
 await openChat();
 expect(document.querySelector('#chatLoadEarlier').hidden).toBe(false);
 mock.rows=[{id:'older',community_id:null,author_id:'u2',content:'Older history',created_at:'2026-10-08T09:00:00Z',author:{nickname:'Emma'}}];
 document.querySelector('#chatLoadEarlier').click();await settle();
 expect(mock.query.some(q=>q[0]==='or' && q[1].includes('created_at.lt.'))).toBe(true);
 expect(document.querySelector('[data-msg-id="older"] [data-edit-msg]')).not.toBeNull();
 expect(document.querySelector('#chatLoadEarlier').hidden).toBe(true);
});

it('returns a pulled-down group chat to its community Info without interrupting message scrolling', async () => {
  await openChat({ id: 'c-pull', title: 'Walk' });
  const returned = vi.fn();
  document.addEventListener('chat-return-info', returned);
  const list = document.querySelector('#chatMessages');
  const touch = (type, y) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: 30, clientY: y }] });
    list.dispatchEvent(event);
  };
  list.scrollTop = 100;
  touch('touchstart', 20); touch('touchmove', 150); touch('touchend', 150);
  expect(returned).not.toHaveBeenCalled();
  list.scrollTop = 0;
  touch('touchstart', 20); touch('touchmove', 150); touch('touchend', 150);
  expect(returned.mock.calls[0][0].detail).toBe('c-pull');
  expect(location.hash).toBe('#community');
  expect(document.documentElement.classList.contains('chat-fullscreen')).toBe(false);
  document.removeEventListener('chat-return-info', returned);
});
