// ── Dashboard ──
function showDashboard() {
  hideAll();
  $('page-dashboard').classList.remove('hidden');
  $('nav-domain').textContent = window.tenant?.domain || '';
  $('sidebar-domain').textContent = window.tenant?.domain || '';
  $('nav-user').textContent = window.user?.email || '';
  navTo('gws-users');
  const status = document.getElementById('users-sync-status');
  if (status) status.textContent = 'auto-sync pending...';
  loadUsers();
  setTimeout(() => syncUsers(), 500);
}

function navTo(section) {
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
