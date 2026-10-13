// "New" markers for the Community and Guestbook section tabs. Each guest's last visit to a section is
// remembered in this browser; communities and posts by other guests created after it count as new.
// (Chat keeps its own unread badge in chat.js.)
import { supabase } from "./supabase.js";
import { $, debounce } from "./utils.js";

const SECTIONS = {
  community: { table: "communities", author: "creator_id", badge: "#communityNew" },
  guestbook: { table: "posts", author: "author_id", badge: "#guestbookNew" },
};
const SEEN_AFTER_MS = 1500; // a section counts as seen after it has been on screen this long

let me = null;
const lastSeen = {};  // section → ISO time the guest last looked at it
const baseline = {};  // section → lastSeen when the page loaded; items newer than this get a NEW tag

const storageKey = (section) => `wegoinn-seen-${section}-${me.id}`;
function readSeen(section) {
  try { return localStorage.getItem(storageKey(section)); } catch { return null; }
}
function writeSeen(section, iso) {
  try { localStorage.setItem(storageKey(section), iso); } catch { /* badges just reappear next visit */ }
}

export function initNews(profile) {
  me = profile;
  const now = new Date().toISOString();
  for (const section of Object.keys(SECTIONS)) {
    // First visit in this browser: start counting from now instead of flagging the whole history.
    lastSeen[section] = readSeen(section) || now;
    baseline[section] = lastSeen[section];
    writeSeen(section, lastSeen[section]);
  }
  return Promise.all(Object.keys(SECTIONS).map(refreshNew));
}

/** True when an item by another guest was created after the guest's previous visit to the section. */
export function isNew(section, createdAt, authorId) {
  return Boolean(me && baseline[section] && authorId !== me.id && createdAt > baseline[section]);
}

async function refreshNew(section) {
  if (!me) return;
  const { table, author } = SECTIONS[section];
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .gt("created_at", lastSeen[section])
    .neq(author, me.id);
  if (error) return;
  setBadge(section, count || 0);
  // Arrived while the guest is looking at this page: it is seen after the usual moment.
  if (count && section === current) sectionInView(section);
}
export const scheduleNewCommunities = debounce(() => refreshNew("community"), 600);
export const scheduleNewPosts = debounce(() => refreshNew("guestbook"), 600);

function setBadge(section, count) {
  const badge = $(SECTIONS[section].badge);
  if (!badge) return;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = count === 0;
}

const timers = {};
let current = null; // section page currently shown
/** Called with the section on screen; after a moment it is marked as seen and its badge clears. */
export function sectionInView(section) {
  current = section;
  for (const key of Object.keys(timers)) if (key !== section) { clearTimeout(timers[key]); delete timers[key]; }
  if (!me || !SECTIONS[section] || timers[section]) return;
  timers[section] = setTimeout(() => {
    delete timers[section];
    lastSeen[section] = new Date().toISOString();
    writeSeen(section, lastSeen[section]);
    setBadge(section, 0);
  }, SEEN_AFTER_MS);
}
