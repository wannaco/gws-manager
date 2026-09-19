// ── Bulk Signature ──
function loadBulkSection() {
    if (window._bulkEditor) return;
    window._bulkEditor = grapesjs.init({
        container: '#bulk-toolbar',
        fromElement: false,
        height: '300px',
        width: '100%',
        storageManager: { type: 'none' },
        canvas: {
          styles: [
            'body { font-family: sans-serif; font-size:14px; color:#222; max-width:600px; margin:0 auto; }',
            'table { width:100% !important; }'
          ]
        }
    });
    
    // Remove GrapesJS's default (broken) code-view button, replace with our working one
    const setupBulkCodeButton = () => {
        const panel = window._bulkEditor.Panels.getPanel('options');
        if (panel) {
            panel.get('buttons').remove(panel.get('buttons').where({ command: 'gjs-open-code' }));
            panel.get('buttons').remove(panel.get('buttons').where({ command: 'export-template' }));
            panel.get('buttons').remove(panel.get('buttons').where({ id: 'export-template' }));
            if (!panel.get('buttons').where({ id: 'bulk-open-code' }).length) {
                panel.get('buttons').add({
                    id: 'bulk-open-code',
                    className: 'fa fa-code',
                    command: 'bulk-open-code',
                    attributes: { title: 'Edit HTML' }
                });
            }
        }
        // Also hide via DOM as fallback in case the panel button removal didn't take
        const toolbar = document.querySelector('#bulk-toolbar .gjs-pn-options');
        if (toolbar) {
            toolbar.querySelectorAll('[data-command="gjs-open-code"]').forEach(el => el.remove());
        }
    };
    window._bulkEditor.Commands.add('bulk-open-code', {
        run: function(editor, sender) {
            sender && sender.set('active', 0);
            openBulkCodeEditor();
        }
    });
    window._bulkEditor.on('load', setupBulkCodeButton);
    setTimeout(setupBulkCodeButton, 500);

    // Add template manager to bulk section
    loadTemplatesList();
}

async function loadTemplatesList() {
    const r = await api('GET', '/gws/signature-templates');
    window._loadedTemplates = r.templates || [];
    const container = document.createElement('div');
    container.className = 'p-4 border-t';
    container.innerHTML = `
        <h3 class="font-bold mb-2">Saved Templates</h3>
        <div class="flex gap-2">
            <select id="template-select" class="select select-bordered select-sm">
                <option value="">Select a template...</option>
                ${window._loadedTemplates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
            </select>
            <button class="btn btn-sm" onclick="applyTemplate()">Apply</button>
        </div>
    `;
    // Prevent duplicates
    const existing = document.getElementById('template-manager-box');
    if (existing) existing.remove();
    container.id = 'template-manager-box';
    $('section-sig-bulk').appendChild(container);
}
function applyTemplate() {
    var tid = document.getElementById('template-select')?.value;
    if (!tid || !window._loadedTemplates) return;
    var t = window._loadedTemplates.find(function(x) { return x.id === tid; });
    if (t && window._bulkEditor) window._bulkEditor.setComponents(cleanHtmlString(t.html));
}

function openRecipientModal() {
    const box = $('modal-box');
    let html = `<h3 class="font-bold text-lg mb-4">Select Recipients</h3>
        <div class="max-h-64 overflow-y-auto mb-4 border rounded p-2">
            ${domainUsers.map(u => `
                <label class="flex items-center gap-2 p-1 hover:bg-base-200 cursor-pointer">
                    <input type="checkbox" class="checkbox checkbox-sm" value="${esc(u.email)}" onchange="updateRecipientList()">
                    <span class="text-sm">${esc(u.name || u.email)}</span>
                </label>
            `).join('')}
        </div>
        <div class="modal-action">
            <button class="btn" onclick="closeModal()">Close</button>
            <button class="btn btn-primary" onclick="closeModal()">Confirm</button>
        </div>`;
    box.innerHTML = html;
    $('modal-overlay').classList.remove('hidden');
    // Pre-check existing
    if (window._bulkRecipients) {
        window._bulkRecipients.forEach(email => {
            const cb = document.querySelector(`#modal-box input[value="${email}"]`);
            if (cb) cb.checked = true;
        });
    }
}

function updateRecipientList() {
    const checked = document.querySelectorAll('#modal-box input[type="checkbox"]:checked');
    window._bulkRecipients = Array.from(checked).map(c => c.value);
    $('btn-bulk-apply').disabled = window._bulkRecipients.length === 0;
}

async function executeBulkApply() {
    if (!window._bulkRecipients || window._bulkRecipients.length === 0) return;
    const html = window._bulkEditor ? cleanEditorOutput(window._bulkEditor) : '';
    const btn = $('btn-bulk-apply');
    btn.disabled = true; btn.textContent = 'Applying...';
    try {
        const t = await api('POST', '/gws/signature-templates', { action: 'create', name: 'BulkTemp', html: html });
        await api('POST', '/gws/signature', { action: 'bulkApply', templateId: t.templateId, userEmails: window._bulkRecipients });
        notify('Bulk applied to ' + window._bulkRecipients.length + ' users', 'success');
        await api('POST', '/gws/signature-templates', { action: 'delete', templateId: t.templateId });
    } catch(e) { notify(e.message, 'error'); }
    btn.disabled = false; btn.textContent = 'Bulk Apply';
}

function saveAsTemplateModal() {
    const box = $('modal-box');
    box.innerHTML = `<h3 class="font-bold text-lg mb-4">Save Signature as Template</h3>
        <div class="form-control mb-4">
            <input id="new-template-name" type="text" class="input input-bordered" placeholder="Template Name">
        </div>
        <div class="modal-action">
            <button class="btn" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="doSaveTemplate()">Save</button>
        </div>`;
    $('modal-overlay').classList.remove('hidden');
}

async function doSaveTemplate() {
    const name = $('new-template-name').value.trim();
    if (!name) return;
    try {
        const html = window._bulkEditor ? cleanEditorOutput(window._bulkEditor) : '';
        await api('POST', '/gws/signature-templates', { action: 'create', name: name, html: html });
        notify('Template saved', 'success');
        closeModal();
    } catch(e) { notify(e.message, 'error'); }
}
