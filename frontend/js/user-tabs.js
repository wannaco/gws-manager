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
    el.innerHTML = `
      <h3 class="font-semibold mb-4">Forwarding for ${esc(u.email)}</h3>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="card bg-base-200"><div class="card-body p-4">
          <h4 class="font-bold text-sm">Auto Forwarding</h4>
          <p class="text-sm mt-2">${fwd.enabled ? `✅ Enabled → ${esc(fwd.emailAddress||'')}` : '❌ Disabled'}</p>
          ${fwd.enabled ? `<button class="btn btn-warning btn-xs mt-2" onclick="disableFwd('${esc(u.email)}')">Disable</button>` :
          `<div class="flex gap-2 mt-2"><input id="fwd-enable-email" type="email" class="input input-bordered input-xs flex-1" placeholder="forward@example.com"><button class="btn btn-primary btn-xs" onclick="enableFwd('${esc(u.email)}')">Enable</button></div>`}
        </div></div>
        <div class="card bg-base-200"><div class="card-body p-4">
          <h4 class="font-bold text-sm">Forwarding Addresses</h4>
          ${addrs.length ? addrs.map(a=>`<div class="text-sm mt-1">${esc(a.forwardingEmail)} <span class="badge badge-xs">${esc(a.verificationStatus||'pending')}</span></div>`).join('') : '<p class="text-sm opacity-50">None</p>'}
          <div class="flex gap-2 mt-3"><input id="fwd-add-email" type="email" class="input input-bordered input-xs flex-1" placeholder="new@example.com"><button class="btn btn-success btn-xs" onclick="addFwdAddr('${esc(u.email)}')">Add</button></div>
        </div></div>
      </div>`;
  } catch(e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
}

async function addFwdAddr(ue) { try { await api('POST','/gws/forwarding',{userEmail:ue,action:'createAddress',forwardingEmail:$('fwd-add-email').value.trim()}); notify('Added','success'); loadForwarding(); } catch(e) { notify(e.message,'error'); } }
async function enableFwd(ue) { try { await api('POST','/gws/forwarding',{userEmail:ue,action:'updateAutoForwarding',enabled:true,emailAddress:$('fwd-enable-email').value.trim(),disposition:'leaveInInbox'}); notify('Enabled','success'); loadForwarding(); } catch(e) { notify(e.message,'error'); } }
async function disableFwd(ue) { try { await api('POST','/gws/forwarding',{userEmail:ue,action:'updateAutoForwarding',enabled:false,emailAddress:'',disposition:'leaveInInbox'}); notify('Disabled','success'); loadForwarding(); } catch(e) { notify(e.message,'error'); } }

async function loadFilters() {
  const u = window._detailUser;
  const el = $('utab-content');
  el.innerHTML = '<div class="flex justify-center py-8"><span class="loading loading-spinner"></span></div>';
  try {
    const r = await api('GET', '/gws/filters?userEmail=' + encodeURIComponent(u.email));
    const filters = r.filters || [];
    el.innerHTML = `<h3 class="font-semibold mb-4">Filters for ${esc(u.email)}</h3>
      ${filters.length ? `<div class="overflow-x-auto"><table class="table table-sm w-full"><thead><tr><th>From</th><th>Subject</th><th>Action</th><th></th></tr></thead><tbody>
        ${filters.map(f=>`<tr><td class="text-sm">${esc((f.criteria||{}).from||'—')}</td><td class="text-sm">${esc((f.criteria||{}).subject||'—')}</td><td>${f.action?'<span class="badge badge-info badge-sm">'+esc(Object.keys(f.action).join(', '))+'</span>':'—'}</td><td><button class="btn btn-error btn-xs btn-outline" onclick="deleteFilter('${esc(u.email)}','${esc(f.id)}')">Delete</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="text-center text-base-content/40 py-8">No filters</p>'}`;
  } catch(e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
}
async function deleteFilter(ue,fid) { try { await api('POST','/gws/filters',{userEmail:ue,action:'delete',filterId:fid}); notify('Deleted','success'); loadFilters(); } catch(e) { notify(e.message,'error'); } }

async function loadVacation() {
  const u = window._detailUser;
  const el = $('utab-content');
  el.innerHTML = '<div class="flex justify-center py-8"><span class="loading loading-spinner"></span></div>';
  try {
    const r = await api('GET', '/gws/vacation?userEmail=' + encodeURIComponent(u.email));
    const v = r.vacation || {};
    el.innerHTML = `<h3 class="font-semibold mb-4">Vacation Responder for ${esc(u.email)}</h3>
      <div class="form-control"><label class="label cursor-pointer"><span class="label-text">Enable Auto-Reply</span><input id="vac-enabled" type="checkbox" class="toggle toggle-primary" ${v.enableAutoReply?'checked':''}></label></div>
      <div class="form-control mt-3"><label class="label"><span class="label-text">Subject</span></label><input id="vac-subject" class="input input-bordered" value="${esc(v.responseSubject||'')}"></div>
      <div class="form-control mt-3"><label class="label"><span class="label-text">Message (HTML)</span></label><textarea id="vac-body" class="textarea textarea-bordered h-24">${esc(v.responseBodyHtml||'')}</textarea></div>
      <button class="btn btn-primary mt-4" onclick="saveVacation('${esc(u.email)}')">Save</button>`;
  } catch(e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
}
async function saveVacation(ue) {
  try {
    await api('POST','/gws/vacation',{userEmail:ue,enableAutoReply:$('vac-enabled').checked,responseSubject:$('vac-subject').value,responseBodyHtml:$('vac-body').value});
    notify('Saved','success');
  } catch(e) { notify(e.message,'error'); }
}

async function loadSendAs() {
  const u = window._detailUser;
  const el = $('utab-content');
  el.innerHTML = '<div class="flex justify-center py-8"><span class="loading loading-spinner"></span></div>';
  try {
    const r = await api('GET', '/gws/send-as?userEmail=' + encodeURIComponent(u.email));
    const sendAs = r.sendAs || [];
    el.innerHTML = `<div class="flex justify-between items-center mb-4"><h3 class="font-semibold">Send As for ${esc(u.email)}</h3><button class="btn btn-primary btn-sm" onclick="openModal('addSendAs')">+ Add Alias</button></div>
      ${sendAs.length ? `<div class="overflow-x-auto"><table class="table table-sm w-full"><thead><tr><th>Send As Email</th><th>Display Name</th><th>Status</th><th></th></tr></thead><tbody>
        ${sendAs.map(s=>`<tr><td class="mono text-sm">${esc(s.sendAsEmail)}</td><td>${esc(s.displayName||'—')}</td><td>${s.verificationStatus==='accepted'?'<span class="badge badge-success badge-sm">Verified</span>':'<span class="badge badge-warning badge-sm">'+esc(s.verificationStatus||'pending')+'</span>'}</td><td>${s.isDefault?'<span class="badge badge-sm">Default</span>':'<button class="btn btn-error btn-xs btn-outline" onclick="removeSendAs(\''+esc(u.email)+'\',\''+esc(s.sendAsEmail)+'\')">Remove</button>'}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="text-center text-base-content/40 py-8">No send-as addresses</p>'}`;
  } catch(e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
}
async function addSendAs() {
  const u = window._detailUser;
  const alias = $('modal-sendas-email')?.value?.trim();
  if (!alias) return;
  try { await api('POST','/gws/send-as',{userEmail:u.email,action:'addAlias',aliasEmail:alias}); closeModal(); loadSendAs(); notify('Alias added','success'); } catch(e) { notify(e.message,'error'); } }
async function removeSendAs(ue,email) { try { await api('POST','/gws/send-as',{userEmail:ue,action:'remove',sendAsEmail:email}); loadSendAs(); notify('Removed','success'); } catch(e) { notify(e.message,'error'); } }

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
      '<div class="flex gap-2 mb-3">' +
      '<select id="sig-addr-picker" class="select select-bordered flex-1" onchange="switchSigAddress(this.value)">' + addrOptions + '</select>' +
      '<button class="btn btn-outline" onclick="saveAsTemplateModal(\'sig\')">Save as Template</button>' +
      '</div>' +
      '<div class="flex gap-2 mb-3" id="sig-template-row"><select id="sig-template-select" class="select select-bordered select-sm flex-1" onchange="onSigTemplateChange()"><option value="">Load a template...</option></select><button class="btn btn-sm btn-error btn-outline" title="Delete the selected template" onclick="deleteSelectedTemplate(\'sig-template-select\')">Delete</button></div>' +
      '<div id="sig-editor" class="border border-base-300 rounded-lg"></div>' +
      '<div class="flex gap-2 flex-wrap mt-2">' +
        '<button class="btn btn-outline btn-xs" onclick="insertPlaceholder(\'{{name}}\')">{{name}}</button>' +
        '<button class="btn btn-outline btn-xs" onclick="insertPlaceholder(\'{{email}}\')">{{email}}</button>' +
        '<button class="btn btn-outline btn-xs" onclick="insertPlaceholder(\'{{title}}\')">{{title}}</button>' +
        '<button class="btn btn-outline btn-xs" onclick="insertPlaceholder(\'{{department}}\')">{{department}}</button>' +
        '<button class="btn btn-outline btn-xs" onclick="insertPlaceholder(\'{{phone}}\')">{{phone}}</button>' +
        '<button class="btn btn-outline btn-xs" onclick="insertPlaceholder(\'{{photoUrl}}\')">{{photoUrl}}</button>' +
        '<button class="btn btn-outline btn-xs" onclick="insertPlaceholder(\'{{firstName}}\')">{{firstName}}</button>' +
        '<button class="btn btn-outline btn-xs" onclick="insertPlaceholder(\'{{lastName}}\')">{{lastName}}</button>' +
        '<button class="btn btn-outline btn-xs" onclick="insertPlaceholder(\'{{company}}\')">{{company}}</button>' +
      '</div>' +
      '<button class="btn btn-primary mt-4" onclick="saveSignature()">Save</button>';

      
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
    notify('Signature saved', 'success');
  } catch(e) { notify(e.message, 'error'); }
}

async function loadCalendarAcl() {
  const u = window._detailUser;
  const el = $('utab-content');
  el.innerHTML = '<div class="flex justify-center py-8"><span class="loading loading-spinner"></span></div>';
  try {
    const r = await api('GET', '/gws/calendar-acl?userEmail=' + encodeURIComponent(u.email));
    const items = r.items || [];
    el.innerHTML = `<div class="flex justify-between items-center mb-4"><h3 class="font-semibold">Calendar Sharing for ${esc(u.email)}</h3><button class="btn btn-primary btn-sm" onclick="openModal('addCalendarAcl')">+ Share</button></div>
      ${items.length ? `<div class="overflow-x-auto"><table class="table table-sm w-full"><thead><tr><th>Scope</th><th>Role</th><th>Type</th><th></th></tr></thead><tbody>
        ${items.map(a=>`<tr><td>${esc((a.scope||{}).value||(a.scope||{}).type||'—')}</td><td><span class="badge badge-sm">${esc(a.role)}</span></td><td>${esc((a.scope||{}).type||'—')}</td><td>${a.role!=='owner'?`<button class="btn btn-error btn-xs btn-outline" onclick="removeCalendarAcl('${esc(u.email)}','${esc(a.id)}')">Remove</button>`:''}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="text-center text-base-content/40 py-8">No sharing rules</p>'}`;
  } catch(e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
}
async function addCalendarAcl() {
  const u = window._detailUser;
  try { await api('POST','/gws/calendar-acl',{userEmail:u.email,action:'add',role:$('modal-cal-role')?.value||'reader',scopeType:'user',scopeValue:$('modal-cal-scope')?.value?.trim()}); closeModal(); loadCalendarAcl(); notify('Shared','success'); } catch(e) { notify(e.message,'error'); } }
async function removeCalendarAcl(ue,ruleId) { try { await api('POST','/gws/calendar-acl',{userEmail:ue,action:'remove',ruleId}); loadCalendarAcl(); notify('Removed','success'); } catch(e) { notify(e.message,'error'); } }

async function populateSigTemplates() {
  try {
    var r = await api('GET', '/gws/signature-templates');
    window._loadedTemplates = r.templates || [];
    var sel = document.getElementById('sig-template-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">Load a template...</option>' +
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
  window._sigEd.setComponents(cleanHtmlString(html));
  notify(`Loaded “${t.name}” — press Save to apply it`, 'info');
}
