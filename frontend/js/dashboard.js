// ── Dashboard ──
// ── Role gating ──────────────────────────────────────────────────────────────
//
// `tenant.role` is "user" | "admin". A "user" is helpdesk: look things up, read
// job history, manage signature content. They cannot change who has access to a
// mailbox, cannot impersonate anyone, and cannot touch the domain's keys.
//
// The API is the enforcement point — every admin route re-checks server-side via
// requireAdmin(). This only stops the UI *offering* buttons that would 403,
// which is its own bug (see the Register tab, which used to do exactly that).
const ADMIN_ONLY_SECTIONS = ['sig-bulk', 'schedules', 'settings'];
const ADMIN_ONLY_TABS = ['delegation', 'forwarding', 'filters', 'vacation', 'sendas', 'calendar'];

function isAdmin() { return !!(window.tenant && window.tenant.isAdmin); }

function applyRoleGating() {
  const admin = isAdmin();

  ADMIN_ONLY_SECTIONS.forEach(function (s) {
    const el = $('sidebar-' + s);
    if (el) el.classList.toggle('hidden', !admin);
  });
  // the Settings heading has nothing left under it for a user
  const head = $('nav-head-settings');
  if (head) head.classList.toggle('hidden', !admin);

  // user-detail tabs: a user keeps Signatures only
  document.querySelectorAll('#section-user-detail [data-utab]').forEach(function (t) {
    const allowed = admin || ADMIN_ONLY_TABS.indexOf(t.dataset.utab) === -1;
    t.classList.toggle('hidden', !allowed);
  });

  // If a user is somehow sitting in an admin section (deep link, console), move
  // them somewhere real rather than showing an empty page.
  const active = document.querySelector('.sidebar-item.active');
  if (!admin && active && ADMIN_ONLY_SECTIONS.some(function (x) { return active.id === 'sidebar-' + x; })) {
    navTo('gws-users');
  }
}

function showDashboard() {
  hideAll();
  $('page-dashboard').classList.remove('hidden');
  $('nav-domain').textContent = window.tenant?.domain || '';
  $('sidebar-domain').textContent = window.tenant?.domain || '';
  $('nav-user').textContent = window.user?.email || '';
  $('nav-role') && ($('nav-role').textContent = window.tenant?.isAdmin ? 'admin' : 'helpdesk');
  // hide what this role's API calls would refuse
  applyRoleGating();
  navTo('gws-users');
  const status = document.getElementById('users-sync-status');
  if (status) status.textContent = 'auto-sync pending...';
  loadUsers();
  setTimeout(() => syncUsers(), 500);
}

function navTo(section) {
  // Same gate as the hidden buttons — a section that would 403 should not
  // be reachable at all.
  if (!isAdmin() && ADMIN_ONLY_SECTIONS.indexOf(section) !== -1) {
    if (typeof notify === 'function') notify('Administrator access required.', 'error');
    section = 'gws-users';
  }
  ['gws-users','settings','user-detail', 'sig-bulk','bulk-jobs','schedules'].forEach(s => $('section-'+s)?.classList.add('hidden'));
  $('section-'+section)?.classList.remove('hidden');
  document.querySelectorAll('.sidebar-item').forEach(a => a.classList.remove('active'));
  $('sidebar-'+section)?.classList.add('active');
  if (section === 'sig-bulk') loadBulkSection();
  if (section === 'bulk-jobs' && typeof onBulkJobsSectionShown === 'function') onBulkJobsSectionShown();
  if (section === 'schedules' && typeof onSchedulesSectionShown === 'function') onSchedulesSectionShown();
  // The settings section is loaded via htmx, so #app-version may not exist yet
  // when this runs. Retry briefly rather than doing nothing silently.
  if (section === 'settings' && typeof loadVersion === 'function') {
    let tries = 0;
    const wait = () => {
      if ($('app-version')) loadVersion();
      else if (tries++ < 20) setTimeout(wait, 50);
    };
    wait();
  }
}
