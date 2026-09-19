// ── Settings ──
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
    const sak = JSON.parse($('settings-sa-key').value.trim());
    const r = await api('POST','/gws/save-domain-config',{domain:$('settings-domain').value.trim(),adminEmail:$('settings-admin-email').value.trim(),serviceAccountKey:sak});
    $('settings-result').innerHTML = r.connectionTest ? '<div class="alert alert-success mt-3 text-sm">✅ Saved & Google verified</div>' : `<div class="alert alert-warning mt-3 text-sm">⚠️ Saved but test failed: ${esc(r.connectionError||'')}</div>`;
    window.tenant.hasServiceAccountKey = true;
    toggleSettingsEdit();
  } catch(e) { $('settings-result').innerHTML = `<div class="alert alert-error mt-3 text-sm">${esc(e.message)}</div>`; }
}
async function saveWebhook() { try { await api('POST','/gws/webhook-config',{action:'save',webhookUrl:$('webhook-url').value.trim()}); notify('Saved','success'); } catch(e) { notify(e.message,'error'); } }
async function testWebhook() { try { const r = await api('POST','/gws/webhook-config',{action:'test'}); notify('Test sent — status: '+r.status,'success'); } catch(e) { notify(e.message,'error'); } }
