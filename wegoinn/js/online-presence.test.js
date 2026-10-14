import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ channel: vi.fn(), removeChannel: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('./supabase.js', () => ({ supabase: { ...mock, auth: mock } }));
import { initOnlinePresence } from './online-presence.js';
let channel, sync, status;
beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<strong id="onlineCount">…</strong>';
  channel = {
    on: vi.fn((type, filter, callback) => { sync = callback; return channel; }),
    subscribe: vi.fn(callback => { status = callback; return channel; }),
    presenceState: vi.fn(() => ({ guest1: [{}, {}], guest2: [{}] })),
    track: vi.fn().mockResolvedValue('ok'), untrack: vi.fn(),
  };
  mock.channel.mockReturnValue(channel);
});
it('counts unique accounts across tabs and publishes after connecting', async () => {
  initOnlinePresence({ id: 'guest1' });
  expect(mock.channel).toHaveBeenCalledWith('wegoinn-online-guests', { config: { presence: { key: 'guest1' } } });
  await status('SUBSCRIBED');
  expect(channel.track).toHaveBeenCalledWith({ online: true });
  sync();
  expect(document.querySelector('#onlineCount').textContent).toBe('2');
  channel.presenceState.mockReturnValue({ guest1: [{}] });
  sync();
  expect(document.querySelector('#onlineCount').textContent).toBe('1');
});
it('clears stale counts on disconnect and leaves on logout', async () => {
  initOnlinePresence({ id: 'guest1' });
  sync();
  await status('CHANNEL_ERROR');
  expect(document.querySelector('#onlineCount').textContent).toBe('…');
  mock.onAuthStateChange.mock.calls[0][0]('SIGNED_OUT');
  expect(mock.removeChannel).toHaveBeenCalledWith(channel);
});
