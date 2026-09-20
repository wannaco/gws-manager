// ── Bulk audience builder ────────────────────────────────────────────────────
// Targets large domains: OU tree (with sub-OU inclusion), Google Groups, a
// free-text filter, manual exclusions, live count and preview.
//
// Nested/derived group membership is NOT expanded — /gws/group-members returns
// direct members only. That limitation is surfaced in the UI.

window._aud = {
    orgUnits: [],      // selected OU paths
    includeSubOUs: false,
    groups: [],        // group emails
    excludes: [],
    emails: [],        // last resolved list
    count: 0,
    ouTree: null,
};

function openAudiencePanel() {
    $('audience-overlay').classList.remove('hidden');
    $('aud-include-sub').checked = !!window._aud.includeSubOUs;
    $('aud-query').value = $('aud-query').value || '';
    renderAudienceChips();
    if (!window._aud.ouTree) loadOrgUnits();
    refreshAudience();
    closeSidebar && closeSidebar();
}

function closeAudiencePanel() {
    $('audience-overlay').classList.add('hidden');
}

// ── org units ────────────────────────────────────────────────────────────────

async function loadOrgUnits() {
    try {
        const r = await api('GET', '/gws/org-units');
        window._aud.ouTree = r.units || [];
        renderOuTree();
    } catch (e) {
        $('aud-ou-tree').innerHTML = `<span class="text-error text-xs">Could not load org units: ${esc(e.message)}</span>`;
    }
}

function renderOuTree() {
    const sel = window._aud.orgUnits || [];
    const sub = $('aud-include-sub').checked;
    window._aud.includeSubOUs = sub;
    const box = $('aud-ou-tree');
    const unit = window._aud.ouTree || [];
    if (!unit.length) { box.innerHTML = '<span class="opacity-50 text-xs">No org units found — run a user sync first.</span>'; return; }

    const totalOf = (n) => sub ? n.totalCount : n.directCount;
    const rows = [];
    const walk = (nodes, depth) => {
        for (const n of nodes) {
            const checked = sel.includes(n.path);
            const indent = 12 + depth * 16;
            rows.push(`<label class="flex items-center gap-2 px-1 py-0.5 hover:bg-base-200 rounded cursor-pointer" style="padding-left:${indent}px">
                <input type="checkbox" class="checkbox checkbox-xs" value="${esc(n.path)}" ${checked ? 'checked' : ''} onchange="toggleOu('${esc(n.path)}')">
                <span class="flex-1">${esc(n.name || n.path)}</span>
                <span class="badge badge-ghost badge-sm">${totalOf(n)}</span>
            </label>`);
            if (n.children && n.children.length) walk(n.children, depth + 1);
        }
    };
    walk(unit, 0);
    box.innerHTML = rows.join('');
    refreshAudience();
}

function toggleOu(path) {
    const i = window._aud.orgUnits.indexOf(path);
    if (i === -1) window._aud.orgUnits.push(path); else window._aud.orgUnits.splice(i, 1);
    refreshAudience();
}

// ── groups / exclusions ──────────────────────────────────────────────────────

function addAudienceGroup() {
    const v = $('aud-group-input').value.trim().toLowerCase();
    if (!v || window._aud.groups.includes(v)) return;
    window._aud.groups.push(v);
    $('aud-group-input').value = '';
    renderAudienceChips();
    refreshAudience();
}

function removeAudienceGroup(v) {
    window._aud.groups = window._aud.groups.filter(g => g !== v);
    renderAudienceChips();
    refreshAudience();
}

function addAudienceExclude() {
    const v = $('aud-exclude-input').value.trim().toLowerCase();
    if (!v || window._aud.excludes.includes(v)) return;
    window._aud.excludes.push(v);
    $('aud-exclude-input').value = '';
    renderAudienceChips();
    refreshAudience();
}

function removeAudienceExclude(v) {
    window._aud.excludes = window._aud.excludes.filter(x => x !== v);
    renderAudienceChips();
    refreshAudience();
}

function renderAudienceChips() {
    $('aud-groups').innerHTML = window._aud.groups.map(g =>
        `<span class="badge badge-primary gap-1">${esc(g)}<button class="btn btn-ghost btn-xs px-1" onclick="removeAudienceGroup('${esc(g)}')">✕</button></span>`).join('');
    $('aud-excludes').innerHTML = window._aud.excludes.map(g =>
        `<span class="badge badge-outline gap-1">${esc(g)}<button class="btn btn-ghost btn-xs px-1" onclick="removeAudienceExclude('${esc(g)}')">✕</button></span>`).join('');
}

// ── resolve ──────────────────────────────────────────────────────────────────

let _audTimer = null;
function scheduleAudienceRefresh() {
    clearTimeout(_audTimer);
    _audTimer = setTimeout(refreshAudience, 350);
}

function audienceSelector() {
    return {
        orgUnits: window._aud.orgUnits,
        includeSubOUs: window._aud.includeSubOUs,
        groups: window._aud.groups,
        query: ($('aud-query').value || '').trim(),
        exclude: window._aud.excludes,
    };
}

async function refreshAudience() {
    const sel = audienceSelector();
    const empty = !sel.orgUnits.length && !sel.groups.length && !sel.query;
    if (empty) {
        window._aud.emails = []; window._aud.count = 0;
        $('aud-total').textContent = 'No filters selected';
        $('aud-apply').disabled = true;
        $('aud-preview').innerHTML = '';
        $('aud-preview-title').textContent = 'Preview';
        return;
    }
    try {
        const r = await api('POST', '/gws/audience/resolve', sel);
        window._aud.emails = r.emails || [];
        window._aud.count = r.count || 0;
        $('aud-total').textContent = `${window._aud.count} recipient${window._aud.count === 1 ? '' : 's'}`;
        $('aud-apply').disabled = window._aud.count === 0;
        $('aud-preview-title').textContent = `Preview (${window._aud.count})`;
        if (!$('aud-preview').classList.contains('hidden')) {
            $('aud-preview').innerHTML = window._aud.emails.slice(0, 500).map(esc).join('<br>')
                + (window._aud.count > 500 ? `<br><em>… and ${window._aud.count - 500} more</em>` : '');
        }
    } catch (e) {
        $('aud-total').textContent = 'Error: ' + e.message;
        $('aud-apply').disabled = true;
    }
}

function toggleAudiencePreview() {
    const p = $('aud-preview');
    const hidden = p.classList.contains('hidden');
    if (hidden) {
        p.classList.remove('hidden');
        $('aud-preview-toggle').textContent = 'Hide';
        p.innerHTML = window._aud.emails.slice(0, 500).map(esc).join('<br>')
            + (window._aud.count > 500 ? `<br><em>… and ${window._aud.count - 500} more</em>` : '');
    } else {
        p.classList.add('hidden');
        $('aud-preview-toggle').textContent = 'Show';
    }
}

function applyAudience() {
    window._bulkRecipients = window._aud.emails.slice();
    updateAudienceSummary();
    closeAudiencePanel();
}

function clearAudience() {
    window._bulkRecipients = [];
    window._aud.orgUnits = []; window._aud.groups = []; window._aud.excludes = []; window._aud.emails = []; window._aud.count = 0;
    $('aud-query').value = '';
    renderAudienceChips(); renderOuTree();
    updateAudienceSummary();
}

function updateAudienceSummary() {
    const n = (window._bulkRecipients || []).length;
    const box = $('audience-summary');
    if (!n) {
        box.classList.add('hidden');
        $('btn-bulk-apply').disabled = true;
        return;
    }
    box.classList.remove('hidden');
    $('audience-count-line').textContent = `${n} recipient${n === 1 ? '' : 's'} selected`;
    const parts = [];
    if (window._aud.orgUnits.length) parts.push(`${window._aud.orgUnits.length} OU${window._aud.orgUnits.length === 1 ? '' : 's'}${window._aud.includeSubOUs ? ' (with sub-OUs)' : ''}`);
    if (window._aud.groups.length) parts.push(`${window._aud.groups.length} group${window._aud.groups.length === 1 ? '' : 's'}`);
    if (($('aud-query').value || '').trim()) parts.push(`text “${$('aud-query').value.trim()}”`);
    if (window._aud.excludes.length) parts.push(`${window._aud.excludes.length} excluded`);
    $('audience-desc-line').textContent = parts.length ? parts.join(' · ') + ' — direct group members only' : '';
    $('btn-bulk-apply').disabled = false;
}

// ── job progress ─────────────────────────────────────────────────────────────

window._bulkJob = null;

function showBulkProgress(total) {
    $('bulk-progress').classList.remove('hidden');
    $('bulk-failures').classList.add('hidden');
    $('bulk-progress-bar').value = 0;
    $('bulk-progress-pct').textContent = '0%';
    $('bulk-progress-label').textContent = `Applying to ${total} user${total === 1 ? '' : 's'}…`;
    $('bulk-progress-detail').textContent = 'Running in the background — you can leave this page.';
}

async function pollBulkJob(jobId) {
    try {
        const s = await api('GET', '/gws/bulk/status?id=' + encodeURIComponent(jobId));
        const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
        $('bulk-progress-bar').value = pct;
        $('bulk-progress-pct').textContent = pct + '%';
        // Surface the throttling/diagnostic counters the API already returns:
        // the difference between "it is slow" and "Google is rate-limiting us"
        // is exactly this line.
        const bits = [`${s.done} of ${s.total} applied`];
        if (s.failedCount) bits.push(`${s.failedCount} failed`);
        if (s.etaMs > 0) bits.push(`~${_fmtDur(s.etaMs)} left`);
        if (s.rateLimited) bits.push(`throttled by Google ${s.rateLimited}x`);
        if (s.throttledMs) bits.push(`waited ${_fmtDur(s.throttledMs)}`);
        if (s.retries) bits.push(`${s.retries} retr${s.retries === 1 ? 'y' : 'ies'}`);
        if (s.stallCount) bits.push(`no progress for ${s.stallCount} tick${s.stallCount === 1 ? '' : 's'}`);
        if (s.dryRun) bits.push('DRY RUN - nothing was changed');
        $('bulk-progress-detail').textContent = bits.join(' | ');
        // keep the job list in step while work is in flight
        if (typeof loadBulkJobs === 'function') loadBulkJobs();
        if (s.failedCount) {
            $('bulk-failures').classList.remove('hidden');
            $('bulk-failures-title').textContent = `${s.failedCount} failed`;
            $('bulk-failures-list').innerHTML = s.failed.map(f =>
                `${esc(f.email)} &mdash; ${esc(f.error || 'unknown error')}`
                + (f.status ? ` <span class="opacity-50">[HTTP ${esc(String(f.status))}${f.reason ? ' ' + esc(f.reason) : ''}]</span>` : '')
            ).join('<br>')
            + (s.failedTotal > s.failed.length
                ? `<div class="opacity-60 pt-1">Showing first ${s.failed.length} of ${s.failedTotal} &mdash; use View failures for the full list.</div>`
                : '');
        }
        if (s.status === 'done' || s.status === 'failed') {
            $('bulk-progress-label').textContent = s.status === 'done'
                ? `✅ Done — ${s.done - s.failedCount} applied`
                : `⚠️ Finished with ${s.failedCount} failure${s.failedCount === 1 ? '' : 's'}`;
            notify(s.status === 'done' ? 'Bulk apply complete' : 'Bulk apply finished with errors', s.status === 'done' ? 'success' : 'error');
            window._bulkJob = null;
            $('btn-bulk-apply').disabled = false;
            $('btn-bulk-apply').textContent = 'Bulk Apply';
            return;
        }
        setTimeout(() => pollBulkJob(jobId), 3000);
    } catch (e) {
        $('bulk-progress-detail').textContent = 'Lost track of the job: ' + e.message;
    }
}

async function retryFailedBulk() {
    const jobId = (typeof lastBulkJob === 'function') ? lastBulkJob() : window._bulkJob;
    if (!jobId) return;
    try {
        const r = await api('POST', '/gws/bulk/retry', { jobId: jobId });
        showBulkProgress(r.total);
        pollBulkJob(r.jobId);
    } catch (e) { notify(e.message, 'error'); }
}
