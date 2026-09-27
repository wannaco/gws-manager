// ── Auth ──
window._authTab = 'signin';

function switchAuthTab(tab) {
  window._authTab = tab;
  hideError('login-error');
  if (tab === 'signin') {
    $('tab-signin').classList.add('tab-active');
    $('tab-register').classList.remove('tab-active');
    $('auth-signin-fields').classList.remove('hidden');
    $('auth-register-fields').classList.add('hidden');
  } else {
    $('tab-register').classList.add('tab-active');
    $('tab-signin').classList.remove('tab-active');
    $('auth-signin-fields').classList.add('hidden');
    $('auth-register-fields').classList.remove('hidden');
  }
}

async function doLogin() {
  const email = $('login-email').value.trim();
  const pass = $('login-password').value;
  if (!email || !pass) return showError('login-error', 'Fill in both fields.');
  try {
    $('btn-login').disabled = true;
    const auth = await api('POST', '/api/collections/users/auth-with-password', { identity: email, password: pass });
    window.token = auth.token;
    window.user = auth.record;
    localStorage.setItem('auth', JSON.stringify(auth));
    await afterLogin();
  } catch(e) {
    showError('login-error', e.message);
  }
  $('btn-login').disabled = false;
}

// The "Create Account" tab is only meaningful on a brand-new install. Anywhere
// else it must be hidden, or the UI advertises something the API refuses.
// This is a convenience only — the real gate is users.createRule = null.
async function refreshSignupAvailability() {
  let tries = 0;
  const apply = async () => {
    const tab = $('tab-register');
    // The login component arrives via htmx, so the tab may not exist yet.
    if (!tab) { if (tries++ < 20) setTimeout(apply, 50); return; }
    let open = false;
    try {
      const s = await api('GET', '/gws/bootstrap-status');
      open = !!s.canBootstrap;
    } catch (_) { open = false; }
    tab.classList.toggle('hidden', !open);
    // Don't leave the user parked on a tab that no longer exists.
    if (!open && window._authTab === 'register') switchAuthTab('signin');
  };
  apply();
}

async function doRegister() {
  const email = $('reg-email').value.trim();
  const pass = $('reg-password').value;
  const confirm = $('reg-password-confirm').value;
  if (!email || !pass) return showError('login-error', 'Fill in both fields.');
  if (pass.length < 8) return showError('login-error', 'Password must be 8+ characters.');
  if (pass !== confirm) return showError('login-error', 'Passwords do not match.');
  try {
    $('btn-register').disabled = true;
    // Through /gws/bootstrap, not the collection route: public creation is
    // disabled (backend/1786000070_lock_signup.js). The endpoint accepts the
    // FIRST account only and returns 409 afterwards.
    await api('POST', '/gws/bootstrap', { email, password: pass, passwordConfirm: confirm });
    // Auto-login after registration
    const auth = await api('POST', '/api/collections/users/auth-with-password', { identity: email, password: pass });
    window.token = auth.token;
    window.user = auth.record;
    localStorage.setItem('auth', JSON.stringify(auth));
    await afterLogin();
  } catch(e) {
    showError('login-error', e.message);
    $('btn-register').disabled = false;
    // A 409 means someone else finished setup; stop offering the tab.
    if (String(e.message || '').toLowerCase().includes('already')) refreshSignupAvailability();
  }
}

function doLogout() {
  window.token = null; window.user = null; window.tenant = null; window.domainUsers = [];
  localStorage.removeItem('auth');
  hideAll(); $('page-login').classList.remove('hidden');
  $('login-email').value = ''; $('login-password').value = '';
  $('reg-email').value = ''; $('reg-password').value = ''; $('reg-password-confirm').value = '';
  switchAuthTab('signin');
  refreshSignupAvailability();
}

async function afterLogin() {
  try {
    window.tenant = (await api('GET', '/gws/get-tenant')).tenant;
  } catch(e) { tenant = null; }
  hideAll();
  if (!window.tenant || !window.tenant.domain) {
    $('page-setup').classList.remove('hidden');
  } else {
    showDashboard();
  }
}
