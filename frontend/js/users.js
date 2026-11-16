// ── Users list ──
async function loadUsers() {
  const tbody = $('users-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8"><span class="loading loading-spinner"></span> Loading domain users...</td></tr>';
  hideError('users-error');
  try {
    const q = $('user-search').value.trim();
    const params = { userEmail: tenant?.adminEmail || user?.email };
    if (q) params.query = q;
    const r = await api('GET', '/gws/list-users?' + new URLSearchParams(params));
    domainUsers = r.users || [];
    renderUsers();
  } catch(e) {
    showError('users-error', e.message);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-error">Failed to load users</td></tr>';
  }
}

async function syncUsers() {
  const btn = document.querySelector('[onclick="syncUsers()"]');
  const status = document.getElementById('users-sync-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }
  if (status) status.textContent = 'syncing...';
  try {
    const r = await api('POST', '/gws/sync-users');
    notify('Synced ' + (r.total || 0) + ' users', 'success');
    await loadUsers();
    if (status) status.textContent = 'synced ' + (r.total || 0) + ' users at ' + new Date().toLocaleTimeString();
  } catch(e) {
    notify(e.message, 'error');
    if (status) status.textContent = 'sync failed';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Users'; }
  }
}

function renderUsers() {
  const tbody = $('users-tbody');
  if (!domainUsers.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-base-content/40">No users found</td></tr>';
    return;
  }
  tbody.innerHTML = domainUsers.map(u => `
    <tr class="hover cursor-pointer" onclick="openUserDetail('${esc(u.email)}')">
      <td class="font-medium">${esc(u.name||u.email)}</td>
      <td class="text-sm mono">${esc(u.email)}</td>
      <td><span class="badge badge-ghost badge-sm">${esc(u.orgUnitPath||'/')}</span></td>
      <td>${u.isAdmin?'<span class="badge badge-warning badge-sm">Admin</span>':''}</td>
      <td class="hidden md:table-cell text-sm opacity-60">${esc(u.phone||'—')}</td>
    </tr>`).join('');
}

// ── User detail ──
function openUserDetail(email, preferredTab, opts) {
  const u = domainUsers.find(x => x.email && x.email.toLowerCase() === String(email || '').toLowerCase());
  if (!u) {
    if (opts && opts.skipHash && typeof navTo === 'function') {
      navTo('gws-users');
    }
    return;
  }
  window._detailUser = u;
  ['gws-users','settings','sig-bulk','bulk-jobs','schedules'].forEach(s => $('section-'+s)?.classList.add('hidden'));
  $('section-user-detail').classList.remove('hidden');
  document.querySelectorAll('.sidebar-item').forEach(a => a.classList.remove('active'));
  $('sidebar-gws-users')?.classList.add('active');
  $('detail-name').textContent = u.name || u.email;
  $('detail-email').textContent = u.email;
  // A helpdesk user has no Delegation tab (it grants mailbox access), so land
  // them on Signatures instead of a tab that is hidden and would 403.
  const canAdmin = typeof isAdmin === 'function' && isAdmin();
  let tab = preferredTab || (canAdmin ? 'delegation' : 'signatures');
  if (!canAdmin && typeof ADMIN_ONLY_TABS !== 'undefined' && ADMIN_ONLY_TABS.indexOf(tab) !== -1) {
    tab = 'signatures';
  }
  switchUserTab(tab, opts);
}

function closeUserDetail() {
  if (typeof navTo === 'function') {
    navTo('gws-users');
  } else {
    $('section-user-detail').classList.add('hidden');
    $('section-gws-users').classList.remove('hidden');
  }
}

function switchUserTab(tab, opts) {
  const canAdmin = typeof isAdmin === 'function' && isAdmin();
  if (!canAdmin && typeof ADMIN_ONLY_TABS !== 'undefined' && ADMIN_ONLY_TABS.indexOf(tab) !== -1) {
    tab = 'signatures';
  }
  window.activeUserTab = tab;
  killSig(); document.querySelectorAll('#section-user-detail .tab').forEach(t => t.classList.remove('tab-active'));
  document.querySelector('[data-utab="'+tab+'"]')?.classList.add('tab-active');
  if ((!opts || !opts.skipHash) && window._detailUser && typeof setRouteHash === 'function') {
    setRouteHash('/users/' + encodeURIComponent(window._detailUser.email) + '/' + tab);
  }
  const fns = { delegation:loadDelegation, forwarding:loadForwarding, filters:loadFilters, vacation:loadVacation, sendas:loadSendAs, signatures:loadSignature, calendar:loadCalendarAcl };
  if (fns[tab]) fns[tab]();
}
