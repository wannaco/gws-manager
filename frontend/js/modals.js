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
  box.className = 'bg-base-100 rounded-box shadow-2xl w-full max-w-md p-6 fade-in max-h-[90vh] overflow-y-auto';
  const u = window._detailUser;
  let html = '';
  if (type === 'addDelegate') {
    html = `<h3 class="font-bold text-lg mb-2">Add Delegate</h3>
      <p class="text-xs opacity-70 mb-4">Grant delegate access to ${esc(u.email)}'s mailbox.</p>
      <div class="gws-field"><label class="gws-label">Delegate Email</label><input id="modal-add-delegate-email" type="email" class="input input-bordered input-sm w-full" placeholder="colleague@domain.com"></div>
      <div class="modal-action"><button class="btn btn-sm" onclick="closeModal()">Cancel</button><button class="btn btn-primary btn-sm" onclick="addDelegate()">Add</button></div>`;
  } else if (type === 'addSendAs') {
    html = `<h3 class="font-bold text-lg mb-2">Add Send-As Alias</h3>
      <p class="text-xs opacity-70 mb-4">Allow ${esc(u.email)} to send mail as another address.</p>
      <div class="gws-field"><label class="gws-label">Alias Email</label><input id="modal-sendas-email" type="email" class="input input-bordered input-sm w-full" placeholder="alias@domain.com"></div>
      <div class="gws-field"><label class="gws-label">Display Name <span class="opacity-50">(optional)</span></label><input id="modal-sendas-name" type="text" class="input input-bordered input-sm w-full" placeholder="Support Team"></div>
      <div class="modal-action"><button class="btn btn-sm" onclick="closeModal()">Cancel</button><button class="btn btn-primary btn-sm" onclick="addSendAs()">Add</button></div>`;
  } else if (type === 'addCalendarAcl') {
    html = `<h3 class="font-bold text-lg mb-2">Share Calendar</h3>
      <p class="text-xs opacity-70 mb-4">Share ${esc(u.email)}'s primary calendar.</p>
      <div class="gws-field"><label class="gws-label">Share With</label>
        <select id="modal-cal-type" class="select select-bordered select-sm w-full mb-2">
          <option value="user">User</option>
          <option value="group">Google Group</option>
        </select>
        <input id="modal-cal-scope" type="email" class="input input-bordered input-sm w-full" placeholder="person@domain.com">
      </div>
      <div class="gws-field"><label class="gws-label">Permission Role</label>
        <select id="modal-cal-role" class="select select-bordered select-sm w-full">
          <option value="freeBusyReader">See only free/busy (hide details)</option>
          <option value="reader" selected>See all event details (Reader)</option>
          <option value="writer">Make changes to events (Writer)</option>
          <option value="owner">Make changes and manage sharing (Owner)</option>
        </select>
      </div>
      <div class="modal-action"><button class="btn btn-sm" onclick="closeModal()">Cancel</button><button class="btn btn-primary btn-sm" onclick="addCalendarAcl()">Share</button></div>`;
  } else if (type === 'addFilter') {
    html = `<h3 class="font-bold text-lg mb-2">Create Mail Filter</h3>
      <p class="text-xs opacity-70 mb-4">Create a Gmail filter for ${esc(u.email)}.</p>
      <div class="gws-grid-2">
        <div class="gws-field"><label class="gws-label">From</label><input id="flt-from" type="text" class="input input-bordered input-sm w-full" placeholder="sender@domain.com"></div>
        <div class="gws-field"><label class="gws-label">To</label><input id="flt-to" type="text" class="input input-bordered input-sm w-full" placeholder="alias@domain.com"></div>
      </div>
      <div class="gws-field"><label class="gws-label">Subject</label><input id="flt-subject" type="text" class="input input-bordered input-sm w-full" placeholder="Invoice"></div>
      <div class="gws-field"><label class="gws-label">Has the words <span class="opacity-50">(query)</span></label><input id="flt-query" type="text" class="input input-bordered input-sm w-full" placeholder="urgent OR billing"></div>
      <div class="gws-hr"></div>
      <div class="gws-field">
        <label class="gws-label">Actions</label>
        <div class="flex flex-col gap-2 text-sm">
          <label class="label cursor-pointer justify-start gap-2 py-0"><input id="flt-archive" type="checkbox" class="checkbox checkbox-xs"><span>Skip the Inbox (Archive it)</span></label>
          <label class="label cursor-pointer justify-start gap-2 py-0"><input id="flt-read" type="checkbox" class="checkbox checkbox-xs"><span>Mark as read</span></label>
          <label class="label cursor-pointer justify-start gap-2 py-0"><input id="flt-star" type="checkbox" class="checkbox checkbox-xs"><span>Star it</span></label>
          <label class="label cursor-pointer justify-start gap-2 py-0"><input id="flt-trash" type="checkbox" class="checkbox checkbox-xs"><span>Delete it (Trash)</span></label>
        </div>
      </div>
      <div class="gws-field"><label class="gws-label">Forward to <span class="opacity-50">(optional verified address)</span></label><input id="flt-forward" type="email" class="input input-bordered input-sm w-full" placeholder="forward@domain.com"></div>
      <div class="modal-action"><button class="btn btn-sm" onclick="closeModal()">Cancel</button><button class="btn btn-primary btn-sm" onclick="createFilter()">Create Filter</button></div>`;
  }
  box.innerHTML = html;
  $('modal-overlay').classList.remove('hidden');
}
function closeModal() { $('modal-overlay').classList.add('hidden'); }
