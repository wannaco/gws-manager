// ── Settings ──
async function loadSettings() {
  try {
    const r = await api('GET', '/gws/get-tenant');
    if (r.tenant) window.tenant = r.tenant;
  } catch (_) {}
  const t = window.tenant || {};
  if ($('settings-domain')) $('settings-domain').value = t.domain || '';
  if ($('settings-admin-email')) $('settings-admin-email').value = t.adminEmail || '';
  if ($('webhook-url')) $('webhook-url').value = t.webhookUrl || '';
  if ($('settings-sa-key')) {
    $('settings-sa-key').value = '';
    $('settings-sa-key').placeholder = t.hasServiceAccountKey
      ? 'Configured — leave blank to keep existing key, or paste a new JSON key to replace...'
      : 'Paste your GCP service account JSON key...';
  }
  const saStatus = $('settings-sa-status');
  if (saStatus) {
    if (t.hasServiceAccountKey) {
      saStatus.innerHTML = `<span class="badge badge-success badge-sm">Connected</span>${t.saClientEmail ? ` <span class="mono text-base-content/70">${esc(t.saClientEmail)}</span>` : ''}`;
    } else {
      saStatus.innerHTML = '<span class="badge badge-warning badge-sm">Not configured</span>';
    }
  }
}

function toggleSettingsEdit() {
  const edit = $('btn-edit-settings');
  const save = $('btn-save-settings');
  const isEdit = save.classList.contains('hidden');
  ['settings-domain','settings-admin-email','settings-sa-key'].forEach(id => $(id).disabled = !isEdit);
  edit.classList.toggle('hidden', isEdit);
  save.classList.toggle('hidden', !isEdit);
}
async function saveSettings() {
  try {
    const rawKey = $('settings-sa-key').value.trim();
    const sak = rawKey ? JSON.parse(rawKey) : null;
    const payload = { domain: $('settings-domain').value.trim(), adminEmail: $('settings-admin-email').value.trim() };
    if (sak) payload.serviceAccountKey = sak;
    const r = await api('POST', '/gws/save-domain-config', payload);
    $('settings-result').innerHTML = r.connectionTest ? '<div class="alert alert-success mt-3 text-sm">Saved &amp; Google verified</div>' : `<div class="alert alert-warning mt-3 text-sm">Saved but test failed: ${esc(r.connectionError||'')}</div>`;
    window.tenant = Object.assign({}, window.tenant || {}, {
      domain: r.domain,
      adminEmail: r.adminEmail,
      hasServiceAccountKey: true,
      saClientEmail: r.saClientEmail || window.tenant?.saClientEmail || ''
    });
    if ($('nav-domain')) $('nav-domain').textContent = r.domain || '';
    if ($('sidebar-domain')) $('sidebar-domain').textContent = r.domain || '';
    loadSettings();
    toggleSettingsEdit();
  } catch(e) { $('settings-result').innerHTML = `<div class="alert alert-error mt-3 text-sm">${esc(e.message)}</div>`; }
}
// ── Build identity ──
// Shown in Settings so a bug report can name the exact build. Served by
// GET /gws/version, which reads build-time env vars stamped in by the Dockerfile.
window._buildInfo = null;
async function loadVersion() {
  try {
    const v = await api('GET', '/gws/version');
    window._buildInfo = v;
    const parts = [];
    if (v.version) parts.push(`v${v.version}`);
    parts.push(v.commit && v.commit !== 'unknown' ? v.commit : 'local dev');
    if (v.buildDate && v.buildDate !== 'unknown') parts.push(`built ${v.buildDate}`);
    if (v.pocketbase && v.pocketbase !== 'unknown') parts.push(`PocketBase ${v.pocketbase}`);
    $('app-version').textContent = parts.join(' · ');
  } catch (e) {
    // Never fail silently: an unknown version is itself worth reporting.
    $('app-version').textContent = 'version unavailable (' + (e.message || 'error') + ')';
  }
}
function copyVersion() {
  const t = $('app-version').textContent;
  navigator.clipboard?.writeText('GWS Manager ' + t)
    .then(() => notify('Build info copied', 'success'))
    .catch(() => notify('Copy failed — select the text manually', 'error'));
}

async function saveWebhook() { try { await api('POST','/gws/webhook-config',{action:'save',webhookUrl:$('webhook-url').value.trim()}); notify('Saved','success'); } catch(e) { notify(e.message,'error'); } }
async function testWebhook() { try { const r = await api('POST','/gws/webhook-config',{action:'test'}); notify('Test sent — status: '+r.status,'success'); } catch(e) { notify(e.message,'error'); } }
