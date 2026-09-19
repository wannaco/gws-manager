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
function openUserDetail(email) {
  const u = domainUsers.find(x => x.email === email);
  if (!u) return;
  window._detailUser = u;
  $('section-gws-users').classList.add('hidden');
  $('section-user-detail').classList.remove('hidden');
  $('detail-name').textContent = u.name || u.email;
  $('detail-email').textContent = u.email;
  window.activeUserTab = 'delegation';
  killSig(); document.querySelectorAll('#section-user-detail .tab').forEach(t => t.classList.remove('tab-active'));
  document.querySelector('[data-utab="delegation"]')?.classList.add('tab-active');
  loadDelegation();
}

function closeUserDetail() {
  $('section-user-detail').classList.add('hidden');
  $('section-gws-users').classList.remove('hidden');
}

function switchUserTab(tab) {
  activeUserTab = tab;
  killSig(); document.querySelectorAll('#section-user-detail .tab').forEach(t => t.classList.remove('tab-active'));
  document.querySelector('[data-utab="'+tab+'"]')?.classList.add('tab-active');
  const fns = { delegation:loadDelegation, forwarding:loadForwarding, filters:loadFilters, vacation:loadVacation, sendas:loadSendAs, signatures:loadSignature, calendar:loadCalendarAcl };
  if (fns[tab]) fns[tab]();
}
