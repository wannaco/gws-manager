// ── User tabs ──
async function loadDelegation() {
  const u = window._detailUser;
  const el = $('utab-content');
  el.innerHTML = '<div class="flex justify-center py-8"><span class="loading loading-spinner"></span></div>';
  try {
    const r = await api('GET', '/gws/delegation?userEmail=' + encodeURIComponent(u.email));
    const delegates = r.delegates || [];
    el.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h3 class="font-semibold">Delegates for ${esc(u.email)}</h3>
        <button class="btn btn-primary btn-sm" onclick="openModal('addDelegate')">+ Add</button>
      </div>
      ${delegates.length ? `<div class="overflow-x-auto"><table class="table table-sm w-full"><thead><tr><th>Delegate Email</th><th>Status</th><th></th></tr></thead><tbody>
        ${delegates.map(d=>`<tr><td class="mono text-sm">${esc(d.delegateEmail)}</td><td><span class="badge badge-sm ${d.verificationStatus==='accepted'?'badge-success':'badge-warning'}">${esc(d.verificationStatus||'pending')}</span></td><td><button class="btn btn-error btn-xs btn-outline" onclick="removeDelegate('${esc(d.delegateEmail)}')">Remove</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="text-center text-base-content/40 py-8">No delegates configured</p>'}`;
  } catch(e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
}

async function addDelegate() {
  const u = window._detailUser;
  const email = $('modal-add-delegate-email')?.value?.trim();
  if (!email) return;
  try {
    await api('POST', '/gws/delegation', { userEmail: u.email, action: 'add', delegateEmail: email });
    closeModal();
    loadDelegation();
    notify('Delegate added', 'success');
  } catch(e) { notify(e.message, 'error'); }
}

async function removeDelegate(delegateEmail) {
  const u = window._detailUser;
  if (!confirm(`Remove ${delegateEmail} as delegate for ${u.email}?`)) return;
  try {
    await api('POST', '/gws/delegation', { userEmail: u.email, action: 'remove', delegateEmail });
    loadDelegation();
    notify('Delegate removed', 'success');
  } catch(e) { notify(e.message, 'error'); }
}

async function loadForwarding() {
  const u = window._detailUser;
  const el = $('utab-content');
  el.innerHTML = '<div class="flex justify-center py-8"><span class="loading loading-spinner"></span></div>';
  try {
    const r = await api('GET', '/gws/forwarding?userEmail=' + encodeURIComponent(u.email));
    const fwd = r.autoForwarding || {};
    const addrs = r.forwardingAddresses || [];
    const dispLabels = {
      leaveInInbox: 'Keep Gmail copy in Inbox',
      archive: 'Archive Gmail copy',
      markRead: 'Mark Gmail copy as read',
      delete: 'Delete Gmail copy'
    };
    const verifiedAddrs = addrs.filter(a => a.verificationStatus === 'accepted');
    el.innerHTML = `
      <h3 class="font-semibold mb-4">Forwarding for ${esc(u.email)}</h3>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="gws-panel">
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-bold text-sm">Auto Forwarding</h4>
            ${fwd.enabled ? '<span class="badge badge-success badge-sm">Enabled</span>' : '<span class="badge badge-ghost badge-sm">Disabled</span>'}
          </div>
          ${fwd.enabled ? `
            <p class="text-sm mt-2">Forwarding to <span class="mono font-semibold">${esc(fwd.emailAddress || '')}</span></p>
            <p class="text-xs opacity-60 mt-1">${esc(dispLabels[fwd.disposition] || fwd.disposition || 'Keep Gmail copy in Inbox')}</p>
            <button class="btn btn-warning btn-xs mt-3" onclick="disableFwd('${esc(u.email)}')">Disable</button>
          ` : `
            <div class="space-y-2 mt-3">
              ${verifiedAddrs.length ? `
                <select id="fwd-enable-select" class="select select-bordered select-xs w-full" onchange="if(this.value)$('fwd-enable-email').value=this.value">
                  <option value="">Pick a verified address...</option>
                  ${verifiedAddrs.map(a => `<option value="${esc(a.forwardingEmail)}">${esc(a.forwardingEmail)}</option>`).join('')}
                </select>
              ` : ''}
              <input id="fwd-enable-email" type="email" class="input input-bordered input-xs w-full" placeholder="forward@example.com">
              <select id="fwd-disposition" class="select select-bordered select-xs w-full">
                <option value="leaveInInbox">Keep Gmail copy in Inbox</option>
                <option value="archive">Archive Gmail copy</option>
                <option value="markRead">Mark Gmail copy as read</option>
                <option value="delete">Delete Gmail copy</option>
              </select>
              <button class="btn btn-primary btn-xs" onclick="enableFwd('${esc(u.email)}')">Enable</button>
            </div>
          `}
        </div>
        <div class="gws-panel">
          <h4 class="font-bold text-sm mb-2">Forwarding Addresses</h4>
          ${addrs.length ? `<div class="space-y-1.5 mb-3">${addrs.map(a => `
            <div class="flex items-center justify-between gap-2 text-sm border border-base-300 rounded-lg px-2.5 py-1.5">
              <div class="min-w-0 truncate">
                <span class="mono text-xs">${esc(a.forwardingEmail)}</span>
                <span class="badge badge-xs ml-1 ${a.verificationStatus === 'accepted' ? 'badge-success' : 'badge-warning'}">${esc(a.verificationStatus || 'pending')}</span>
              </div>
              <button class="btn btn-ghost btn-xs text-error" onclick="deleteFwdAddr('${esc(u.email)}','${esc(a.forwardingEmail)}')">Remove</button>
            </div>
          `).join('')}</div>` : '<p class="text-xs opacity-50 mb-3">No forwarding addresses configured.</p>'}
          <div class="flex gap-2">
            <input id="fwd-add-email" type="email" class="input input-bordered input-xs flex-1" placeholder="new@example.com">
            <button class="btn btn-outline btn-xs" onclick="addFwdAddr('${esc(u.email)}')">Add</button>
          </div>
        </div>
      </div>`;
  } catch(e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
}

async function addFwdAddr(ue) {
  const email = $('fwd-add-email')?.value?.trim();
  if (!email) return;
  try { await api('POST','/gws/forwarding',{userEmail:ue,action:'createAddress',forwardingEmail:email}); notify('Forwarding address added','success'); loadForwarding(); } catch(e) { notify(e.message,'error'); }
}
async function deleteFwdAddr(ue, email) {
  if (!confirm(`Remove forwarding address ${email}?`)) return;
  try { await api('POST','/gws/forwarding',{userEmail:ue,action:'deleteAddress',forwardingEmail:email}); notify('Forwarding address removed','success'); loadForwarding(); } catch(e) { notify(e.message,'error'); }
}
async function enableFwd(ue) {
  const email = $('fwd-enable-email')?.value?.trim();
  if (!email) { notify('Enter or pick a forwarding address', 'error'); return; }
  const disposition = $('fwd-disposition')?.value || 'leaveInInbox';
  try { await api('POST','/gws/forwarding',{userEmail:ue,action:'updateAutoForwarding',enabled:true,emailAddress:email,disposition:disposition}); notify('Auto-forwarding enabled','success'); loadForwarding(); } catch(e) { notify(e.message,'error'); }
}
async function disableFwd(ue) {
  if (!confirm(`Disable auto-forwarding for ${ue}?`)) return;
  try { await api('POST','/gws/forwarding',{userEmail:ue,action:'updateAutoForwarding',enabled:false,emailAddress:'',disposition:'leaveInInbox'}); notify('Auto-forwarding disabled','success'); loadForwarding(); } catch(e) { notify(e.message,'error'); }
}

function _formatFilterActions(a) {
  if (!a) return '—';
  const tags = [];
  if ((a.removeLabelIds || []).includes('INBOX')) tags.push('Archive');
  if ((a.removeLabelIds || []).includes('UNREAD')) tags.push('Mark read');
  if ((a.addLabelIds || []).includes('STARRED')) tags.push('Star');
  if ((a.addLabelIds || []).includes('TRASH')) tags.push('Trash');
  if (a.forward) tags.push('Forward → ' + a.forward);
  const extraLabels = (a.addLabelIds || []).filter(l => l !== 'STARRED' && l !== 'TRASH');
  if (extraLabels.length) tags.push('Labels: ' + extraLabels.join(', '));
  if (!tags.length) tags.push(Object.keys(a).join(', '));
  return tags.map(t => `<span class="badge badge-ghost badge-xs mr-1">${esc(t)}</span>`).join('');
}

async function loadFilters() {
  const u = window._detailUser;
  const el = $('utab-content');
  el.innerHTML = '<div class="flex justify-center py-8"><span class="loading loading-spinner"></span></div>';
  try {
    const r = await api('GET', '/gws/filters?userEmail=' + encodeURIComponent(u.email));
    const filters = r.filters || [];
    el.innerHTML = `<div class="flex justify-between items-center mb-4"><h3 class="font-semibold">Filters for ${esc(u.email)}</h3><button class="btn btn-primary btn-sm" onclick="openModal('addFilter')">+ Add Filter</button></div>
      ${filters.length ? `<div class="overflow-x-auto"><table class="table table-sm w-full"><thead><tr><th>From</th><th>To</th><th>Subject / Query</th><th>Actions</th><th></th></tr></thead><tbody>
        ${filters.map(f => {
          const c = f.criteria || {};
          const sq = [c.subject ? 'Subject: ' + c.subject : '', c.query ? 'Query: ' + c.query : ''].filter(Boolean).join(' · ') || '—';
          return `<tr><td class="text-xs mono">${esc(c.from || '—')}</td><td class="text-xs mono">${esc(c.to || '—')}</td><td class="text-xs">${esc(sq)}</td><td>${_formatFilterActions(f.action)}</td><td class="text-right"><button class="btn btn-error btn-xs btn-outline" onclick="deleteFilter('${esc(u.email)}','${esc(f.id)}')">Delete</button></td></tr>`;
        }).join('')}
      </tbody></table></div>` : '<p class="text-center text-base-content/40 py-8">No filters configured</p>'}`;
  } catch(e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
}

async function createFilter() {
  const u = window._detailUser;
  const criteria = {};
  const from = $('flt-from')?.value?.trim(); if (from) criteria.from = from;
  const to = $('flt-to')?.value?.trim(); if (to) criteria.to = to;
  const subject = $('flt-subject')?.value?.trim(); if (subject) criteria.subject = subject;
  const query = $('flt-query')?.value?.trim(); if (query) criteria.query = query;
  if (!Object.keys(criteria).length) { notify('Specify at least one filter condition (From, To, Subject, or Words)', 'error'); return; }

  const action = {};
  const addLabelIds = [], removeLabelIds = [];
  if ($('flt-archive')?.checked) removeLabelIds.push('INBOX');
  if ($('flt-read')?.checked) removeLabelIds.push('UNREAD');
  if ($('flt-star')?.checked) addLabelIds.push('STARRED');
  if ($('flt-trash')?.checked) addLabelIds.push('TRASH');
  const fwd = $('flt-forward')?.value?.trim(); if (fwd) action.forward = fwd;
  if (addLabelIds.length) action.addLabelIds = addLabelIds;
  if (removeLabelIds.length) action.removeLabelIds = removeLabelIds;
  if (!Object.keys(action).length) { notify('Pick at least one action', 'error'); return; }

  try {
    await api('POST', '/gws/filters', { userEmail: u.email, criteria: criteria, action: action });
    closeModal();
    loadFilters();
    notify('Filter created', 'success');
  } catch(e) { notify(e.message, 'error'); }
}

async function deleteFilter(ue, fid) {
  if (!confirm('Delete this mail filter?')) return;
  try { await api('POST','/gws/filters',{userEmail:ue,action:'delete',filterId:fid}); notify('Filter deleted','success'); loadFilters(); } catch(e) { notify(e.message,'error'); }
}

function _msToLocalInput(ms) {
  if (!ms) return '';
  var d = new Date(Number(ms));
  if (isNaN(d.getTime())) return '';
  var pad = function(n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function _collectVacationPayload() {
  var startVal = $('vac-start')?.value;
  var endVal = $('vac-end')?.value;
  var startMs = startVal ? String(new Date(startVal).getTime()) : '';
  var endMs = endVal ? String(new Date(endVal).getTime()) : '';
  var html = window._vacEd ? getEditorHtml(window._vacEd) : ($('vac-body')?.value || '');
  return {
    enableAutoReply: !!$('vac-enabled')?.checked,
    responseSubject: $('vac-subject')?.value || '',
    responseBodyHtml: html,
    startTime: startMs || undefined,
    endTime: endMs || undefined,
    restrictToContacts: !!$('vac-contacts')?.checked,
    restrictToDomain: !!$('vac-domain')?.checked
  };
}

async function loadVacation() {
  const u = window._detailUser;
  const el = $('utab-content');
  el.innerHTML = '<div class="flex justify-center py-8"><span class="loading loading-spinner"></span></div>';
  try {
    const r = await api('GET', '/gws/vacation?userEmail=' + encodeURIComponent(u.email));
    const v = r.vacation || {};
    const startVal = _msToLocalInput(v.startTime);
    const endVal = _msToLocalInput(v.endTime);

    el.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 class="font-semibold">Vacation Responder for ${esc(u.email)}</h3>
        <label class="label cursor-pointer gap-2 py-0">
          <span class="label-text text-sm font-medium">Enable Auto-Reply</span>
          <input id="vac-enabled" type="checkbox" class="toggle toggle-primary toggle-sm" ${v.enableAutoReply ? 'checked' : ''}>
        </label>
      </div>

      <div class="gws-grid-2 mb-3">
        <div class="gws-field">
          <label class="gws-label">Start Date &amp; Time <span class="opacity-50">(optional)</span></label>
          <input id="vac-start" type="datetime-local" class="input input-bordered input-sm w-full" value="${esc(startVal)}">
        </div>
        <div class="gws-field">
          <label class="gws-label">End Date &amp; Time <span class="opacity-50">(optional)</span></label>
          <input id="vac-end" type="datetime-local" class="input input-bordered input-sm w-full" value="${esc(endVal)}">
        </div>
      </div>

      <div class="flex flex-wrap gap-4 mb-4">
        <label class="label cursor-pointer gap-2 py-0">
          <input id="vac-contacts" type="checkbox" class="checkbox checkbox-sm" ${v.restrictToContacts ? 'checked' : ''}>
          <span class="label-text text-sm">Only send to my Contacts</span>
        </label>
        <label class="label cursor-pointer gap-2 py-0">
          <input id="vac-domain" type="checkbox" class="checkbox checkbox-sm" ${v.restrictToDomain ? 'checked' : ''}>
          <span class="label-text text-sm">Only send to people in ${esc((window.tenant && window.tenant.domain) || 'domain')}</span>
        </label>
      </div>

      <div class="gws-field">
        <label class="gws-label">Subject</label>
        <input id="vac-subject" class="input input-bordered input-sm w-full" placeholder="Out of Office" value="${esc(v.responseSubject || '')}">
      </div>

      <div class="gws-field">
        <label class="gws-label">Message</label>
        <div id="vac-editor" class="gws-editor-wrap min-h-[180px]"></div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-base-300">
        <button class="btn btn-primary btn-sm" onclick="saveVacation('${esc(u.email)}')">Apply Now</button>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs opacity-60">Or schedule push:</span>
          <input id="vac-push-at" type="datetime-local" class="input input-bordered input-xs">
          <button class="btn btn-outline btn-sm" onclick="scheduleVacationPush('${esc(u.email)}')">Schedule Push</button>
        </div>
      </div>

      <div id="vac-schedules-wrap" class="mt-6 hidden">
        <h4 class="gws-label mb-2">Scheduled Pushes</h4>
        <div id="vac-schedules-list" class="gws-stack"></div>
      </div>`;

    setTimeout(function() {
      var host = document.getElementById('vac-editor');
      if (host && typeof createSignatureEditor === 'function') {
        window._vacEd = createSignatureEditor(host, v.responseBodyHtml || '', { height: '180px', minHeight: '140px' });
      }
    }, 50);

    loadVacationSchedules(u.email);
  } catch(e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
}

async function saveVacation(ue) {
  try {
    var payload = _collectVacationPayload();
    if (payload.startTime && payload.endTime && Number(payload.startTime) > Number(payload.endTime)) {
      notify('End date must be after start date', 'error'); return;
    }
    await api('POST', '/gws/vacation', Object.assign({ userEmail: ue }, payload));
    notify('Vacation responder applied', 'success');
  } catch(e) { notify(e.message, 'error'); }
}

async function scheduleVacationPush(ue) {
  var pushAt = $('vac-push-at')?.value;
  if (!pushAt) { notify('Pick a date and time to schedule the push', 'error'); return; }
  var payload = _collectVacationPayload();
  if (payload.startTime && payload.endTime && Number(payload.startTime) > Number(payload.endTime)) {
    notify('End date must be after start date', 'error'); return;
  }
  try {
    await api('POST', '/gws/vacation-schedules', Object.assign({
      action: 'create',
      userEmail: ue,
      pushAt: new Date(pushAt).toISOString()
    }, payload));
    notify('Vacation responder push scheduled', 'success');
    $('vac-push-at').value = '';
    loadVacationSchedules(ue);
  } catch(e) { notify(e.message, 'error'); }
}

async function loadVacationSchedules(ue) {
  var wrap = $('vac-schedules-wrap');
  var list = $('vac-schedules-list');
  if (!wrap || !list) return;
  try {
    var r = await api('GET', '/gws/vacation-schedules?userEmail=' + encodeURIComponent(ue));
    var items = r.items || [];
    if (!items.length) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    list.innerHTML = items.map(function(s) {
      var badge = s.status === 'pending' ? 'badge-info'
        : s.status === 'sent' ? 'badge-success'
        : s.status === 'failed' ? 'badge-error' : 'badge-ghost';
      var when = s.pushAt ? new Date(s.pushAt).toLocaleString() : '—';
      var subj = (s.payload && s.payload.responseSubject) ? s.payload.responseSubject : '(no subject)';
      return `
        <div class="gws-row gws-row-tight">
          <div class="gws-row-main">
            <div class="gws-row-title">
              <span class="badge badge-xs ${badge}">${esc(s.status)}</span>
              <span class="text-xs font-semibold">${esc(when)}</span>
              <span class="text-xs opacity-60">${esc(subj)}</span>
            </div>
            ${s.lastError ? `<div class="text-xs text-error mt-1">${esc(s.lastError)}</div>` : ''}
          </div>
          <div class="gws-row-actions">
            ${s.status === 'pending' ? `<button class="btn btn-xs btn-ghost text-error" onclick="cancelVacationSchedule('${esc(s.id)}','${esc(ue)}')">Cancel</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (_) {}
}

async function cancelVacationSchedule(id, ue) {
  try {
    await api('POST', '/gws/vacation-schedules', { action: 'cancel', id: id });
    notify('Scheduled push cancelled', 'info');
    loadVacationSchedules(ue);
  } catch(e) { notify(e.message, 'error'); }
}

async function loadSendAs() {
  const u = window._detailUser;
  const el = $('utab-content');
  el.innerHTML = '<div class="flex justify-center py-8"><span class="loading loading-spinner"></span></div>';
  try {
    const r = await api('GET', '/gws/send-as?userEmail=' + encodeURIComponent(u.email));
    const sendAs = r.sendAs || [];
    el.innerHTML = `<div class="flex justify-between items-center mb-4"><h3 class="font-semibold">Send As for ${esc(u.email)}</h3><div class="flex gap-2"><button type="button" class="btn btn-ghost btn-sm" onclick="openSendAsHelpModal()">? Guide</button><button class="btn btn-primary btn-sm" onclick="openModal('addSendAs')">+ Add Alias</button></div></div>
      ${sendAs.length ? `<div class="overflow-x-auto"><table class="table table-sm w-full"><thead><tr><th>Send As Email</th><th>Display Name</th><th>Status</th><th></th></tr></thead><tbody>
        ${sendAs.map(s => {
          const flags = [];
          if (s.isPrimary) flags.push('<span class="badge badge-ghost badge-xs">Primary</span>');
          if (s.isDefault) flags.push('<span class="badge badge-info badge-xs">Default</span>');
          return `<tr>
            <td class="mono text-xs">${esc(s.sendAsEmail)}</td>
            <td class="text-sm">${esc(s.displayName || '—')}</td>
            <td>${s.verificationStatus === 'accepted' ? '<span class="badge badge-success badge-xs">Verified</span>' : '<span class="badge badge-warning badge-xs">' + esc(s.verificationStatus || 'pending') + '</span>'} ${flags.join(' ')}</td>
            <td class="text-right">${(s.isDefault || s.isPrimary) ? '' : `<button class="btn btn-error btn-xs btn-outline" onclick="removeSendAs('${esc(u.email)}','${esc(s.sendAsEmail)}')">Remove</button>`}</td>
          </tr>`;
        }).join('')}
      </tbody></table></div>` : '<p class="text-center text-base-content/40 py-8">No send-as addresses</p>'}`;
  } catch(e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
}
async function addSendAs() {
  const u = window._detailUser;
  const alias = $('modal-sendas-email')?.value?.trim();
  const displayName = $('modal-sendas-name')?.value?.trim() || '';
  if (!alias) return;
  try { await api('POST','/gws/send-as',{userEmail:u.email,action:'addAlias',aliasEmail:alias,displayName:displayName}); closeModal(); loadSendAs(); notify('Alias added','success'); } catch(e) { notify(e.message,'error'); }
}
async function removeSendAs(ue, email) {
  if (!confirm(`Remove send-as alias ${email} from ${ue}?`)) return;
  try { await api('POST','/gws/send-as',{userEmail:ue,action:'remove',sendAsEmail:email}); loadSendAs(); notify('Alias removed','success'); } catch(e) { notify(e.message,'error'); }
}

async function loadSignature() {
  var u = window._detailUser;
  var el = $('utab-content');
  el.innerHTML = '<div class="flex justify-center py-8"><span class="loading loading-spinner"></span></div>';
  try {
    var sendAs = [];
    try {
      var saResp = await api('GET', '/gws/send-as?userEmail=' + encodeURIComponent(u.email));
      sendAs = saResp.sendAs || [];
    } catch(e) {}
    window._sendAsAddresses = sendAs;
    if (!sendAs.length) sendAs = [{ sendAsEmail: u.email, isDefault: true, isPrimary: true }];
    
    var selectedAddr = sendAs.find(function(a) { return a.isDefault || a.isPrimary; }) || sendAs[0];
    var se = selectedAddr.sendAsEmail;
    var sigResp = await api('GET', '/gws/signature?userEmail=' + encodeURIComponent(u.email) + '&sendAsEmail=' + encodeURIComponent(se));
    var sig = sigResp.signature || '';
    
    var addrOptions = sendAs.map(function(a) {
      var sel = (a.sendAsEmail === se) ? ' selected' : '';
      return '<option value="' + esc(a.sendAsEmail) + '"' + sel + '>' + esc(a.sendAsEmail) + '</option>';
    }).join('');

    el.innerHTML = '<h3 class="font-semibold mb-4">Signature for ' + esc(u.email) + '</h3>' +
      '<div class="flex flex-wrap gap-2 mb-3">' +
      '<select id="sig-addr-picker" class="select select-bordered select-sm flex-1 min-w-[200px]" onchange="switchSigAddress(this.value)">' + addrOptions + '</select>' +
      '</div>' +
      '<div class="gws-template-bar" id="sig-template-row"><select id="sig-template-select" class="select select-bordered select-sm flex-1 min-w-[200px]" onchange="onSigTemplateChange()"><option value="">Insert a saved template...</option></select><button type="button" class="btn btn-sm btn-primary btn-outline" onclick="openTemplateGallery(\'sig\')">Browse Gallery</button><button class="btn btn-sm btn-error btn-outline" title="Delete the selected template" onclick="deleteSelectedTemplate(\'sig-template-select\')">Delete</button></div>' +
      '<div id="sig-editor" class="gws-editor-wrap"></div>' +
      '<div class="gws-var-row">' +
        '<span class="gws-var-label">Variables:</span>' +
        '<button type="button" class="gws-var-chip" onclick="insertPlaceholder(\'{{name}}\',\'sig\')">{{name}}</button>' +
        '<button type="button" class="gws-var-chip" onclick="insertPlaceholder(\'{{email}}\',\'sig\')">{{email}}</button>' +
        '<button type="button" class="gws-var-chip" onclick="insertPlaceholder(\'{{title}}\',\'sig\')">{{title}}</button>' +
        '<button type="button" class="gws-var-chip" onclick="insertPlaceholder(\'{{department}}\',\'sig\')">{{department}}</button>' +
        '<button type="button" class="gws-var-chip" onclick="insertPlaceholder(\'{{phone}}\',\'sig\')">{{phone}}</button>' +
        '<button type="button" class="gws-var-chip" onclick="insertPlaceholder(\'{{photoUrl}}\',\'sig\')">{{photoUrl}}</button>' +
        '<button type="button" class="gws-var-chip" onclick="insertPlaceholder(\'{{firstName}}\',\'sig\')">{{firstName}}</button>' +
        '<button type="button" class="gws-var-chip" onclick="insertPlaceholder(\'{{lastName}}\',\'sig\')">{{lastName}}</button>' +
        '<button type="button" class="gws-var-chip" onclick="insertPlaceholder(\'{{company}}\',\'sig\')">{{company}}</button>' +
      '</div>' +
      '<div class="flex flex-wrap items-center gap-2 mt-4">' +
        '<button class="btn btn-primary btn-sm" onclick="saveSignature()">Apply</button>' +
        '<button class="btn btn-outline btn-sm" onclick="saveAsTemplateModal(\'sig\')">Save as Template</button>' +
      '</div>';

      
    window._sigSendAs = se;
    window._sigUser = u.email;
    setTimeout(function() { mkSig(sig); }, 300);
    // Populate template dropdown
    populateSigTemplates();
  } catch(e) { el.innerHTML = 'Error'; }
}
async function switchSigAddress(newAddr) {
  var u = window._detailUser;
  if (!newAddr) return;
  window._sigSendAs = newAddr;
  try {
    var r = await api('GET', '/gws/signature?userEmail=' + encodeURIComponent(u.email) + '&sendAsEmail=' + encodeURIComponent(newAddr));
    var sig = r.signature || '';
    mkSig(sig);
  } catch(e) {
    mkSig('');
    notify('Failed to load signature: ' + e.message, 'error');
  }
}
async function saveSignature() {
  try {
    await api('POST', '/gws/signature', {
      action: 'update',
      userEmail: window._sigUser,
      sendAsEmail: window._sigSendAs,
      signature: getSig()
    });
    notify('Signature applied', 'success');
  } catch(e) { notify(e.message, 'error'); }
}

async function loadCalendarAcl() {
  const u = window._detailUser;
  const el = $('utab-content');
  el.innerHTML = '<div class="flex justify-center py-8"><span class="loading loading-spinner"></span></div>';
  try {
    const r = await api('GET', '/gws/calendar-acl?userEmail=' + encodeURIComponent(u.email));
    const items = r.items || [];
    const roles = ['freeBusyReader', 'reader', 'writer', 'owner'];
    const roleLabels = { freeBusyReader: 'Free/Busy', reader: 'Reader', writer: 'Writer', owner: 'Owner' };
    const userDomain = (u.email.split('@')[1] || '').toLowerCase();
    el.innerHTML = `<div class="flex justify-between items-center mb-4"><h3 class="font-semibold">Calendar Sharing for ${esc(u.email)}</h3><button class="btn btn-primary btn-sm" onclick="openModal('addCalendarAcl')">+ Share</button></div>
      ${items.length ? `<div class="overflow-x-auto"><table class="table table-sm w-full"><thead><tr><th>Scope</th><th>Type</th><th>Role</th><th></th></tr></thead><tbody>
        ${items.map(a => {
          const stype = (a.scope || {}).type || 'user';
          const sval = (a.scope || {}).value || stype;
          const isDomainOrDefault = (stype === 'domain' || stype === 'default');
          const isSelfOwner = (stype === 'user' && sval.toLowerCase() === u.email.toLowerCase() && a.role === 'owner');
          const isLocked = isDomainOrDefault || isSelfOwner;
          const isExternal = (stype === 'user' && sval.indexOf('@') > -1 && userDomain && sval.split('@')[1].toLowerCase() !== userDomain);
          const roleCell = isLocked
            ? `<span class="badge badge-sm badge-ghost">${esc(roleLabels[a.role] || a.role)}</span>`
            : `<select class="select select-bordered select-xs" onchange="updateCalendarAclRole('${esc(u.email)}','${esc(a.id)}',this.value)">
                ${roles.map(rl => `<option value="${rl}"${a.role === rl ? ' selected' : ''}>${esc(roleLabels[rl])}</option>`).join('')}
               </select>`;
          const actionCell = isDomainOrDefault
            ? '<span class="badge badge-xs badge-ghost opacity-70">Protected</span>'
            : (isSelfOwner
                ? '<span class="badge badge-xs badge-ghost opacity-70">Owner</span>'
                : `<button class="btn btn-error btn-xs btn-outline" onclick="removeCalendarAcl('${esc(u.email)}','${esc(a.id)}','${esc(sval)}')">Remove</button>`);
          return `<tr>
            <td class="mono text-xs">${esc(sval)} ${isExternal ? '<span class="badge badge-warning badge-xs ml-1">External</span>' : ''}</td>
            <td><span class="badge badge-xs badge-ghost">${esc(stype)}</span></td>
            <td>${roleCell}</td>
            <td class="text-right">${actionCell}</td>
          </tr>`;
        }).join('')}
      </tbody></table></div>` : '<p class="text-center text-base-content/40 py-8">No sharing rules</p>'}`;
  } catch(e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
}
async function addCalendarAcl() {
  const u = window._detailUser;
  const scopeValue = $('modal-cal-scope')?.value?.trim();
  const scopeType = $('modal-cal-type')?.value || 'user';
  if (!scopeValue) { notify('Enter a user or group email', 'error'); return; }
  try { await api('POST','/gws/calendar-acl',{userEmail:u.email,action:'add',role:$('modal-cal-role')?.value||'reader',scopeType:scopeType,scopeValue:scopeValue}); closeModal(); loadCalendarAcl(); notify('Calendar shared','success'); } catch(e) { notify(e.message,'error'); }
}
async function updateCalendarAclRole(ue, ruleId, role) {
  try { await api('POST','/gws/calendar-acl',{userEmail:ue,action:'update',ruleId:ruleId,role:role}); notify('Permission updated','success'); } catch(e) { notify(e.message,'error'); loadCalendarAcl(); }
}
async function removeCalendarAcl(ue, ruleId, label) {
  if (!confirm(`Remove calendar access for ${label || ruleId}?`)) return;
  try { await api('POST','/gws/calendar-acl',{userEmail:ue,action:'remove',ruleId}); loadCalendarAcl(); notify('Access removed','success'); } catch(e) { notify(e.message,'error'); }
}

async function populateSigTemplates() {
  try {
    var r = await api('GET', '/gws/signature-templates');
    window._loadedTemplates = r.templates || [];
    var sel = document.getElementById('sig-template-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">Insert a saved template...</option>' +
      window._loadedTemplates.map(function(t) {
        return '<option value="' + t.id + '">' + esc(t.name) + '</option>';
      }).join('');
  } catch(_) {}
}

// Selecting a template LOADS its content into the editor. There is deliberately
// no separate "Apply" button: selecting is the action, and the Save button below
// persists whatever is in the editor. (Applying a template to many mailboxes is
// what Bulk Signatures is for -- this tab edits one address at a time.)
async function onSigTemplateChange() {
  const sel = document.getElementById('sig-template-select');
  if (!sel) return;
  const tid = sel.value;
  if (!tid) return;                       // "Load a template..." = no-op
  const t = (window._loadedTemplates || []).find(x => x.id === tid);
  if (!t) return;
  const html = t.html || '';
  if (!window._sigEd) {
    // never fail silently -- the editor is created a moment after the tab opens
    notify('The editor is still loading — try again in a moment', 'warning');
    return;
  }
  if (!String(html).trim()) {
    notify('That template is empty — add content to it first', 'warning');
    return;
  }
  setEditorHtml(window._sigEd, cleanHtmlString(html));
  notify(`Loaded “${t.name}” — press Apply to update`, 'info');
}
