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
  document.getElementById('theme-icon').textContent = window.theme === 'light' ? '🌙' : '☀️';
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
