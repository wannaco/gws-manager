// Global state variables (exposed globally for modules to access)
window.token = null;
window.user = null;
window.tenant = null;
window.domainUsers = [];
window.activeUserTab = 'delegation';
window.theme = 'light';

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  // Try to restore session from localStorage
  try {
    const savedAuth = localStorage.getItem('auth');
    if (savedAuth) {
      const auth = JSON.parse(savedAuth);
      window.token = auth.token;
      window.user = auth.record;
      afterLogin();
    }
  } catch(e) { console.error('Failed to restore session', e); }

  // Hide the "Create Account" tab unless this is a brand-new install.
  if (typeof refreshSignupAvailability === 'function') refreshSignupAvailability();

  try { const t = localStorage.getItem('theme'); if(t) window.theme = t; } catch(e){}
  document.documentElement.setAttribute('data-theme', window.theme);
  updateThemeIcon();
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) closeSidebar();
  });
});

function openSidebar() {
  document.getElementById('app-sidebar')?.classList.add('sidebar-open');
  document.getElementById('sidebar-overlay')?.classList.remove('hidden');
}
function closeSidebar() {
  document.getElementById('app-sidebar')?.classList.remove('sidebar-open');
  document.getElementById('sidebar-overlay')?.classList.add('hidden');
}

function toggleTheme() {
  window.theme = window.theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', window.theme);
  try { localStorage.setItem('theme', window.theme); } catch(e){}
  updateThemeIcon();
}
function updateThemeIcon() {
  const el = document.getElementById('theme-icon');
  if (!el) return;
  el.innerHTML = window.theme === 'light'
    ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
}

// ── Helpers ──
function $(id) { return document.getElementById(id); }
function hideAll() { ['page-login','page-setup','page-dashboard'].forEach(id => $(id)?.classList.add('hidden')); }
function showError(id, msg) { const e = $(id); if(e) { e.textContent = msg; e.classList.remove('hidden'); } }
function hideError(id) { $(id)?.classList.add('hidden'); }
function notify(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast toast-top toast-end z-50';
  el.innerHTML = `<div class="alert alert-${type||'info'} shadow-lg text-sm">${msg}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Setup / Onboarding ──
function setupNext() {
  const domain = $('setup-domain')?.value.trim();
  const adminEmail = $('setup-admin-email')?.value.trim();
  if (!domain) return showError('setup-error', 'Domain is required.');
  if (!adminEmail) return showError('setup-error', 'Admin email is required.');
  hideError('setup-error');
  $('setup-step-1').classList.add('hidden');
  $('setup-step-2').classList.remove('hidden');
}

function setupBack() {
  hideError('setup-error');
  $('setup-step-2').classList.add('hidden');
  $('setup-step-1').classList.remove('hidden');
}

function handleSaKeyDrop(e) {
  e.preventDefault();
  const dz = $('setup-sa-dropzone');
  if (dz) dz.classList.remove('border-primary', 'bg-primary/5');
  const file = e.dataTransfer?.files?.[0];
  if (file) handleSaKeyFile(file);
}

function handleSaKeyFile(file) {
  if (!file) return;
  hideError('setup-error');
  const statusEl = $('setup-sa-file-status');
  const reader = new FileReader();
  reader.onload = () => {
    const raw = String(reader.result || '').trim();
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.client_email || !parsed.private_key) {
        return showError('setup-error', 'That JSON file is missing client_email or private_key.');
      }
      $('setup-sa-key').value = raw;
      if (statusEl) {
        statusEl.innerHTML = `<span class="text-success font-medium">Loaded ${file.name}</span> (${parsed.client_email})`;
      }
    } catch (_) {
      showError('setup-error', 'Could not parse JSON from ' + file.name + '.');
    }
  };
  reader.readAsText(file);
}

async function doSetup() {
  const domain = $('setup-domain')?.value.trim();
  const adminEmail = $('setup-admin-email')?.value.trim();
  const saKeyRaw = $('setup-sa-key')?.value.trim();
  if (!domain || !adminEmail) return showError('setup-error', 'Domain and admin email are required.');
  if (!saKeyRaw) return showError('setup-error', 'Service account key is required.');

  var saKey;
  try { saKey = JSON.parse(saKeyRaw); } catch (_) {
    return showError('setup-error', 'Invalid JSON — paste the full service account key.');
  }
  if (!saKey.client_email || !saKey.private_key) {
    return showError('setup-error', 'Key must include client_email and private_key.');
  }

  var btn = $('btn-setup-finish');
  btn.disabled = true; btn.textContent = 'Connecting...';
  hideError('setup-error');
  try {
    await api('POST', '/gws/setup', { domain, adminEmail, serviceAccountKey: saKey });
    await afterLogin();
  } catch(e) {
    showError('setup-error', e.message);
    btn.disabled = false; btn.textContent = 'Connect Domain';
  }
}
