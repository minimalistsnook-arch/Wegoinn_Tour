// Admin dashboard.
// The page only *displays* admin tools after get_my_profile() says role = 'admin'.
// The real protection is in the database: every admin-only read/delete is
// checked by RLS or by is_admin() inside SECURITY DEFINER functions, so
// editing anything in DevTools/localStorage grants nothing.
//
// TODO: Configure real admin authentication
// (create staff users in Supabase Auth and promote them — see supabase/schema.sql §7).

import { supabase, errorMessage } from "./supabase.js";
import { isSupabaseConfigured } from "./config.js";
import { getMyProfile } from "./auth.js";
import { $, $$, escapeHtml, formatDateTime, formatDateKey, shortTime, formatFee, toast } from "./utils.js";
import { icon, hydrateIcons } from "./icons.js";

hydrateIcons();

const els = {
  login: $("#adminLogin"),
  loginForm: $("#adminLoginForm"),
  loginError: $("#adminLoginError"),
  app: $("#adminApp"),
  content: $("#adminContent"),
  eyebrow: $("#viewEyebrow"),
  title: $("#viewTitle"),
  meta: $("#viewMeta"),
  drawer: $("#drawer"),
  drawerContent: $("#drawerContent"),
};

const cache = { communities: [] };
let currentView = "posts";

/* ---------------- Auth gate ---------------- */

function showLogin(message = "") {
  els.app.hidden = true;
  els.login.hidden = false;
  els.loginError.hidden = !message;
  els.loginError.textContent = message;
}

async function boot() {
  if (!isSupabaseConfigured()) {
    return showLogin("Supabase isn't configured yet — add your project URL and anon key in js/config.js.");
  }
  const profile = await getMyProfile().catch(() => null);
  if (profile?.role === "admin") return enter(profile);
  if (profile) await supabase.auth.signOut();
  showLogin(profile ? "This account doesn't have admin access." : "");
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { email, password } = els.loginForm.elements;
  const button = els.loginForm.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
    if (error) throw error;
    const profile = await getMyProfile();
    if (profile?.role !== "admin") {
      await supabase.auth.signOut();
      throw new Error("This account doesn't have admin access.");
    }
    password.value = "";
    enter(profile);
  } catch (err) {
    showLogin(errorMessage(err, "Sign-in failed."));
  } finally {
    button.disabled = false;
  }
});

$("#adminSignOut").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.reload();
});

function enter(profile) {
  $("#adminName").textContent = profile.nickname;
  els.login.hidden = true;
  els.app.hidden = false;
  switchView(location.hash.slice(1) || "posts");
}

/* ---------------- Navigation ---------------- */

const VIEWS = {
  posts:        { eyebrow: "Guestbook",  title: "Guestbook posts",        load: loadPosts },
  comments:     { eyebrow: "Guestbook",  title: "Comments & replies",     load: loadComments },
  communities:  { eyebrow: "Community",  title: "Communities",            load: loadCommunities },
  applications: { eyebrow: "Community",  title: "Community applications", load: loadApplications },
  guests:       { eyebrow: "People",     title: "Guests",                 load: loadGuests },
};

$$(".sidebar__nav [data-view]").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));
$("#refreshView").addEventListener("click", () => switchView(currentView));

function switchView(name) {
  if (!VIEWS[name]) name = "posts";
  currentView = name;
  history.replaceState(null, "", `#${name}`);
  $$(".sidebar__nav [data-view]").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
  els.eyebrow.textContent = VIEWS[name].eyebrow;
  els.title.textContent = VIEWS[name].title;
  els.meta.textContent = "";
  els.content.innerHTML = `<div class="a-loader"></div>`;
  VIEWS[name].load().catch((err) => {
    els.content.innerHTML = `<div class="a-empty">${escapeHtml(errorMessage(err))}</div>`;
  });
}

/* ---------------- Table helper ---------------- */

function table(columns, rows, emptyText) {
  els.meta.textContent = `${rows.length} ${rows.length === 1 ? "record" : "records"}`;
  if (!rows.length) {
    els.content.innerHTML = `<div class="a-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  els.content.innerHTML = `
    <div class="table-wrap">
      <table class="a-table">
        <thead><tr>${columns.map((c) => `<th class="${c.cls || ""}">${c.label}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `<tr>${columns.map((c) => `<td class="${c.cls || ""}" data-label="${c.label}">${c.render(row)}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

const text = (v, cls = "") => `<span class="${cls}">${escapeHtml(v ?? "—")}</span>`;
const clamp = (v) => `<div class="clamp">${escapeHtml(v || "—")}</div>`;
const secret = (v) => `<code class="secret">${escapeHtml(v || "—")}</code>`;
const statusTag = (s) => `<span class="a-tag a-tag--${s}">${escapeHtml(s)}</span>`;
const deleteBtn = (kind, id) =>
  `<button type="button" class="a-btn a-btn--danger a-btn--sm" data-delete="${kind}" data-id="${id}">${icon("trash")} Delete</button>`;

/* ---------------- Views ---------------- */

async function loadPosts() {
  const { data, error } = await supabase
    .from("posts")
    .select("id, content, image_url, original_language, created_at, author:profiles ( nickname ), comments ( count )")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;

  table([
    { label: "Posted", cls: "nowrap", render: (r) => text(formatDateTime(r.created_at), "muted") },
    { label: "Author", render: (r) => `<b>${escapeHtml(r.author?.nickname ?? "—")}</b>` },
    { label: "Post", cls: "wide", render: (r) => clamp(r.content) },
    { label: "Photo", render: (r) => r.image_url
        ? `<a href="${escapeHtml(r.image_url)}" target="_blank" rel="noopener noreferrer"><img class="thumb" src="${escapeHtml(r.image_url)}" alt="" loading="lazy" /></a>`
        : text("—", "muted") },
    { label: "Lang", render: (r) => text(r.original_language || "—", "muted") },
    { label: "Comments", cls: "num", render: (r) => text(r.comments?.[0]?.count ?? 0) },
    { label: "", cls: "actions", render: (r) => deleteBtn("posts", r.id) },
  ], data, "No guestbook posts yet.");
}

async function loadComments() {
  const { data, error } = await supabase
    .from("comments")
    .select("id, content, parent_comment_id, created_at, author:profiles ( nickname ), post:posts ( content )")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;

  table([
    { label: "Posted", cls: "nowrap", render: (r) => text(formatDateTime(r.created_at), "muted") },
    { label: "Author", render: (r) => `<b>${escapeHtml(r.author?.nickname ?? "—")}</b>` },
    { label: "Type", render: (r) => `<span class="a-tag ${r.parent_comment_id ? "a-tag--reply" : ""}">${r.parent_comment_id ? "Reply" : "Comment"}</span>` },
    { label: "Comment", cls: "wide", render: (r) => clamp(r.content) },
    { label: "On post", render: (r) => `<div class="clamp muted">${escapeHtml(r.post?.content || "(photo post)")}</div>` },
    { label: "", cls: "actions", render: (r) => deleteBtn("comments", r.id) },
  ], data, "No comments yet.");
}

async function loadCommunities() {
  const { data, error } = await supabase.rpc("admin_list_communities");
  if (error) throw error;
  cache.communities = data;

  table([
    { label: "Date", cls: "nowrap", render: (r) => `<b>${escapeHtml(formatDateKey(r.community_date, { month: "short", day: "numeric", year: "numeric" }))}</b><br><span class="muted">${escapeHtml(shortTime(r.community_time))}</span>` },
    { label: "Community", cls: "wide", render: (r) => `<b>${escapeHtml(r.title)}</b><div class="clamp muted">${escapeHtml(r.activity)}</div>` },
    { label: "Creator", render: (r) => `<b>${escapeHtml(r.creator_nickname)}</b>` },
    { label: "Reservation No.", render: (r) => secret(r.reservation_number) },
    { label: "Participants", cls: "nowrap", render: (r) => `${r.approved_count} / ${r.max_participants}${r.approved_count >= r.max_participants ? ` <span class="a-tag a-tag--full">FULL</span>` : ""}` },
    { label: "Pending", cls: "num", render: (r) => r.pending_count ? `<span class="a-tag a-tag--pending">${r.pending_count}</span>` : text("0", "muted") },
    { label: "Fee", cls: "nowrap", render: (r) => text(formatFee(r.participation_fee)) },
    { label: "", cls: "actions", render: (r) => `<button type="button" class="a-btn a-btn--ghost a-btn--sm" data-community="${r.id}">Details</button>` },
  ], data, "No communities yet.");
}

async function loadApplications() {
  const { data, error } = await supabase
    .from("community_applications")
    .select("id, status, created_at, reviewed_at, community:communities ( title, community_date, community_time ), applicant:profiles ( nickname )")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;

  table([
    { label: "Applied", cls: "nowrap", render: (r) => text(formatDateTime(r.created_at), "muted") },
    { label: "Community", cls: "wide", render: (r) => `<b>${escapeHtml(r.community?.title ?? "—")}</b>` },
    { label: "Date", cls: "nowrap", render: (r) => r.community ? text(`${formatDateKey(r.community.community_date, { month: "short", day: "numeric" })} · ${shortTime(r.community.community_time)}`) : "—" },
    { label: "Applicant", render: (r) => `<b>${escapeHtml(r.applicant?.nickname ?? "—")}</b>` },
    { label: "Status", render: (r) => statusTag(r.status) },
    { label: "Reviewed", cls: "nowrap", render: (r) => text(r.reviewed_at ? formatDateTime(r.reviewed_at) : "—", "muted") },
  ], data, "No applications yet.");
}

async function loadGuests() {
  const { data, error } = await supabase.rpc("admin_list_guests");
  if (error) throw error;

  table([
    { label: "Joined", cls: "nowrap", render: (r) => text(formatDateTime(r.created_at), "muted") },
    { label: "Nickname", cls: "wide", render: (r) => `<b>${escapeHtml(r.nickname)}</b>` },
    { label: "Role", render: (r) => `<span class="a-tag ${r.role === "admin" ? "a-tag--admin" : ""}">${escapeHtml(r.role)}</span>` },
    { label: "Reservation No.", render: (r) => secret(r.reservation_number) },
  ], data, "No guests yet.");
}

/* ---------------- Actions ---------------- */

els.content.addEventListener("click", async (event) => {
  const del = event.target.closest("[data-delete]");
  if (del) {
    const kind = del.dataset.delete;
    const label = kind === "posts" ? "this post (and all its comments)" : "this comment (and its replies)";
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    del.disabled = true;
    const { data, error } = await supabase.from(kind).delete().eq("id", del.dataset.id).select("id");
    if (error || !data?.length) {
      del.disabled = false;
      return toast(error ? errorMessage(error) : "Delete was not permitted.", "error");
    }
    toast("Deleted.");
    return switchView(currentView);
  }

  const detail = event.target.closest("[data-community]");
  if (detail) openCommunityDrawer(detail.dataset.community);
});

async function openCommunityDrawer(id) {
  const c = cache.communities.find((x) => x.id === id);
  if (!c) return;
  els.drawerContent.innerHTML = `<div class="a-loader"></div>`;
  els.drawer.hidden = false;
  requestAnimationFrame(() => els.drawer.classList.add("is-open"));

  const { data: apps, error } = await supabase
    .from("community_applications")
    .select("id, status, created_at, reviewed_at, applicant:profiles ( nickname )")
    .eq("community_id", id)
    .order("created_at");

  els.drawerContent.innerHTML = `
    <p class="eyebrow">${escapeHtml(formatDateKey(c.community_date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))} · ${escapeHtml(shortTime(c.community_time))}</p>
    <h2 id="drawerTitle">${escapeHtml(c.title)}</h2>

    <dl class="facts">
      <div><dt>Creator</dt><dd>${escapeHtml(c.creator_nickname)}</dd></div>
      <div><dt>Reservation No. (community)</dt><dd>${secret(c.reservation_number)}</dd></div>
      <div><dt>Reservation No. (creator profile)</dt><dd>${secret(c.creator_profile_reservation_number)}</dd></div>
      <div><dt>Participants</dt><dd>${c.approved_count} / ${c.max_participants}</dd></div>
      <div><dt>Pending</dt><dd>${c.pending_count}</dd></div>
      <div><dt>Fee</dt><dd>${escapeHtml(formatFee(c.participation_fee))}</dd></div>
      <div><dt>Created</dt><dd>${escapeHtml(formatDateTime(c.created_at))}</dd></div>
    </dl>

    <section class="d-block"><h3>Activity</h3><p>${escapeHtml(c.activity)}</p></section>
    <section class="d-block"><h3>Looking for</h3><p>${escapeHtml(c.preferred_participants)}</p></section>
    <section class="d-block"><h3>Plan</h3><p>${escapeHtml(c.schedule)}</p></section>

    <section class="d-block">
      <h3>Applications</h3>
      ${error ? `<p class="muted">${escapeHtml(errorMessage(error))}</p>`
        : apps.length ? `<ul class="d-apps">${apps.map((a) => `
            <li><b>${escapeHtml(a.applicant?.nickname ?? "—")}</b>
                <span class="muted">${escapeHtml(formatDateTime(a.created_at))}</span>
                ${statusTag(a.status)}</li>`).join("")}</ul>`
        : `<p class="muted">No applications.</p>`}
    </section>`;
}

function closeDrawer() {
  els.drawer.classList.remove("is-open");
  setTimeout(() => (els.drawer.hidden = true), 250);
}
els.drawer.addEventListener("click", (e) => e.target.closest("[data-close-drawer]") && closeDrawer());
document.addEventListener("keydown", (e) => e.key === "Escape" && !els.drawer.hidden && closeDrawer());

boot();
