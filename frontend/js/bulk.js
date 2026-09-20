// ── Bulk Signature ──
function loadBulkSection() {
    // Always refresh the job list / re-attach to a running job, even when the
    // editor is already initialised.
    if (typeof onBulkSectionShown === 'function') onBulkSectionShown();
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
            <button class="btn btn-sm btn-error btn-outline" title="Delete the selected template"
                    onclick="deleteSelectedTemplate('template-select')">Delete</button>
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

async function executeBulkApply() {
    const recipients = window._bulkRecipients || [];
    if (!recipients.length) return;
    const html = window._bulkEditor ? cleanEditorOutput(window._bulkEditor) : '';
    if (_isEffectivelyEmpty(html)) { notify('Signature is empty', 'error'); return; }

    const btn = $('btn-bulk-apply');
    btn.disabled = true; btn.textContent = 'Starting...';
    try {
        // Send the signature WITH the job. Previously this created a brand new
        // template named "BulkTemp" on every single run just so the worker had an
        // id to read, which left an undeletable pile of identical rows behind.
        const r = await api('POST', '/gws/bulk/start', {
            html: html,
            emails: recipients,
            selector: audienceSelector(),
            dryRun: !!window._bulkDryRun,
        });
        window._bulkJob = r.jobId;
        showBulkProgress(r.total);
        notify('Bulk apply started for ' + r.total + ' users', 'success');
        pollBulkJob(r.jobId);
    } catch (e) {
        notify(e.message, 'error');
        btn.disabled = false;
    }
    btn.textContent = 'Bulk Apply';
}

// `source` says WHICH editor to read. The button that opens this lives on a
// user's Signature tab, so the content must come from that user's editor
// (window._sigEd) -- not from the Bulk Signatures editor. Reading the wrong one
// produced a blank template (and, if the bulk editor happened to hold
// something, silently saved the wrong signature).
function saveAsTemplateModal(source) {
    window._templateSource = source || (window._sigEd ? 'sig' : 'bulk');
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

function _templateHtml() {
    if (window._templateSource === 'sig') {
        return (typeof getSig === 'function') ? getSig()
             : (window._sigEd ? cleanEditorOutput(window._sigEd) : '');
    }
    return window._bulkEditor ? cleanEditorOutput(window._bulkEditor) : '';
}

// GrapesJS always emits its canvas CSS, so an "empty" editor still returns
// something like "<style>* { box-sizing: border-box; }</style>". A plain
// .trim() check therefore passes and a useless template gets stored. Decide on
// what the signature actually SHOWS.
function _isEffectivelyEmpty(html) {
    if (!html) return true;
    const probe = String(html)
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');
    const text = probe.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
    if (text) return false;
    // no text left, but an image / rule / table row is still real content
    return !/<(img|hr|table|tbody|tr|td)\b/i.test(probe);
}

async function doSaveTemplate() {
    const name = $('new-template-name').value.trim();
    if (!name) { notify('Give the template a name', 'error'); return; }
    try {
        const html = _templateHtml();
        // Never silently store an empty template -- that is what created rows
        // with no content, and an empty signature then gets applied to mailboxes.
        if (_isEffectivelyEmpty(html)) {
            notify('Nothing to save - the signature is empty', 'error');
            return;
        }
        await api('POST', '/gws/signature-templates', { action: 'create', name: name, html: html });
        notify('Template saved', 'success');
        closeModal();
    } catch(e) { notify(e.message, 'error'); }
}
