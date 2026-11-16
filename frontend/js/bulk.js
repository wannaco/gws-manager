// ── Bulk Signature ──
function loadBulkSection() {
    // Always refresh the job list / re-attach to a running job, even when the
    // editor is already initialised.
    if (typeof onBulkSectionShown === 'function') onBulkSectionShown();
    if (window._bulkEditor) return;
    window._bulkEditor = createSignatureEditor('#bulk-toolbar', '', { height: '280px' });

    // Populate template dropdown above the editor
    loadTemplatesList();
}

async function loadTemplatesList() {
    try {
        const r = await api('GET', '/gws/signature-templates');
        window._loadedTemplates = r.templates || [];
        const sel = document.getElementById('template-select');
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = '<option value="">Insert a saved template...</option>' +
            window._loadedTemplates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
        if (prev && window._loadedTemplates.some(t => t.id === prev)) {
            sel.value = prev;
        }
    } catch (_) {}
}

function onBulkTemplateChange() {
    var sel = document.getElementById('template-select');
    if (!sel) return;
    var tid = sel.value;
    if (!tid || !window._loadedTemplates) return;
    var t = window._loadedTemplates.find(function(x) { return x.id === tid; });
    if (!t) return;
    if (!window._bulkEditor) {
        notify('The editor is still loading — try again in a moment', 'warning');
        return;
    }
    var html = t.html || '';
    if (!String(html).trim()) {
        notify('That template is empty — add content to it first', 'warning');
        return;
    }
    setEditorHtml(window._bulkEditor, cleanHtmlString(html));
    notify('Loaded “' + t.name + '” into editor', 'info');
}
var applyTemplate = onBulkTemplateChange;

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
        if (typeof loadTemplatesList === 'function') await loadTemplatesList();
        if (typeof populateSigTemplates === 'function') await populateSigTemplates();
    } catch(e) { notify(e.message, 'error'); }
}
