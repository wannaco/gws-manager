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
  ['gws-users','settings','user-detail', 'sig-bulk','bulk-jobs'].forEach(s => $('section-'+s)?.classList.add('hidden'));
  $('section-'+section)?.classList.remove('hidden');
  document.querySelectorAll('.sidebar-item').forEach(a => a.classList.remove('active'));
  $('sidebar-'+section)?.classList.add('active');
  if (section === 'sig-bulk') loadBulkSection();
  if (section === 'bulk-jobs' && typeof onBulkJobsSectionShown === 'function') onBulkJobsSectionShown();
}
