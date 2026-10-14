import { supabase } from './supabase.js';

// One presence key per account: multiple tabs/devices count as one person.
export function initOnlinePresence(profile) {
  const count = document.querySelector('#onlineCount');
  const channel = supabase.channel('wegoinn-online-guests', {
    config: { presence: { key: profile.id } },
  });
  const unavailable = () => { count.textContent = '…'; };
  channel.on('presence', { event: 'sync' }, () => {
    count.textContent = String(Object.keys(channel.presenceState()).length);
  }).subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      const result = await channel.track({ online: true });
      if (result !== 'ok') unavailable();
    } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
      unavailable();
    }
  });
  // Leave immediately on sign-out; disconnected browsers also expire automatically.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') void supabase.removeChannel(channel);
  });
  window.addEventListener('pagehide', () => { void channel.untrack(); });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void channel.track({ online: true });
  });
}
