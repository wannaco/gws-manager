// ── Modal system ──
function openCustomModal(title, content, actions) {
  const box = $('modal-box');
  let actionsHtml = (actions || []).map(a => `<button class="btn ${a.class || ''}" onclick="${a.onclick}">${esc(a.label)}</button>`).join('');
  let html = `
    <h3 class="font-bold text-lg mb-4">${esc(title)}</h3>
    ${content}
    <div class="modal-action">
      ${actionsHtml}
    </div>`;
  box.innerHTML = html;
  $('modal-overlay').classList.remove('hidden');
}

function openModal(type) {
  const box = $('modal-box');
  const u = window._detailUser;
  let html = '';
  if (type === 'addDelegate') html = `<h3 class="font-bold text-lg mb-4">Add Delegate</h3><p class="text-sm opacity-70 mb-3">Grant delegate access to ${esc(u.email)}'s mailbox.</p><div class="form-control"><label class="label"><span class="label-text">Delegate Email</span></label><input id="modal-add-delegate-email" type="email" class="input input-bordered" placeholder="colleague@domain.com"></div><div class="modal-action"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="addDelegate()">Add</button></div>`;
  else if (type === 'addSendAs') html = `<h3 class="font-bold text-lg mb-4">Add Alias</h3><p class="text-sm opacity-70 mb-3">Add a send-as alias for ${esc(u.email)}.</p><div class="form-control"><label class="label"><span class="label-text">Alias Email</span></label><input id="modal-sendas-email" type="email" class="input input-bordered" placeholder="alias@domain.com"></div><div class="modal-action"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="addSendAs()">Add</button></div>`;
  else if (type === 'addCalendarAcl') html = `<h3 class="font-bold text-lg mb-4">Share Calendar</h3><p class="text-sm opacity-70 mb-3">Share ${esc(u.email)}'s calendar.</p><div class="form-control"><label class="label"><span class="label-text">Person Email</span></label><input id="modal-cal-scope" type="email" class="input input-bordered" placeholder="person@domain.com"></div><div class="form-control mt-3"><label class="label"><span class="label-text">Role</span></label><select id="modal-cal-role" class="select select-bordered"><option value="reader">Reader</option><option value="writer">Writer</option><option value="owner">Owner</option></select></div><div class="modal-action"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="addCalendarAcl()">Share</button></div>`;
  box.innerHTML = html;
  $('modal-overlay').classList.remove('hidden');
}
function closeModal() { $('modal-overlay').classList.add('hidden'); }
