// ── Bulk job list ────────────────────────────────────────────────────────────
//
// Renders every bulk job, not just the one this tab started. Before this the
// job id lived in a page variable, so a reload lost the job entirely and there
// was no way to ask "did my bulk apply finish?".
//
// The last job id is kept in localStorage so a reload re-attaches to the
// progress bar instead of orphaning the run.

const BULK_JOB_KEY = 'gws.lastBulkJob';

function rememberBulkJob(jobId) {
    window._bulkJob = jobId || null;
    try {
        if (jobId) localStorage.setItem(BULK_JOB_KEY, jobId);
        else localStorage.removeItem(BULK_JOB_KEY);
    } catch (_) { /* private mode: fall back to the in-memory copy */ }
}

function lastBulkJob() {
    if (window._bulkJob) return window._bulkJob;
    try { return localStorage.getItem(BULK_JOB_KEY); } catch (_) { return null; }
}

function _fmtDur(ms) {
    if (!ms || ms < 0) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return `${m}m ${r}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function _statusBadge(status, dryRun) {
    const label = dryRun ? `${status} (dry run)` : status;
    const cls = status === 'done' ? 'badge-success'
        : status === 'failed' ? 'badge-error'
        : status === 'running' ? 'badge-info' : 'badge-ghost';
    return `<span class="badge badge-sm ${cls}">${esc(label)}</span>`;
}

function renderBulkJobs(data) {
    const box = document.getElementById('bulk-jobs-list');
    if (!box) return;
    if (!data.jobs.length) {
        box.innerHTML = '<div class="text-xs opacity-60 py-2">No bulk jobs yet.</div>';
        return;
    }
    box.innerHTML = data.jobs.map(j => {
        const when = j.startedAt ? new Date(j.startedAt).toLocaleString() : '—';
        const diag = [];
        if (j.etaMs > 0) diag.push(`~${_fmtDur(j.etaMs)} left`);
        if (j.rateLimited) diag.push(`throttled by Google ${j.rateLimited}×`);
        if (j.throttledMs) diag.push(`waited ${_fmtDur(j.throttledMs)}`);
        if (j.retries) diag.push(`${j.retries} retr${j.retries === 1 ? 'y' : 'ies'}`);
        if (j.stallCount) diag.push(`no progress for ${j.stallCount} tick${j.stallCount === 1 ? '' : 's'}`);
        if (j.lastError) diag.push(esc(j.lastError));

        // during a run, show a live bar; otherwise the outcome
        const bar = j.status === 'running'
            ? `<progress class="progress progress-primary w-full h-1.5" value="${j.pct}" max="100"></progress>`
            : '';

        return `
        <div class="border border-base-300 rounded-lg p-3 mb-2 hover:border-primary/50">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2 flex-wrap">
              ${_statusBadge(j.status, j.dryRun)}
              <span class="text-sm font-semibold">${j.done} / ${j.total}</span>
              ${j.failedCount ? `<span class="text-xs text-error font-semibold">${j.failedCount} failed</span>` : ''}
              <span class="text-xs opacity-50 font-mono">${esc(j.jobId)}</span>
            </div>
            <div class="flex items-center gap-2">
              ${j.failedCount ? `<button class="btn btn-xs btn-ghost" onclick="showBulkFailures('${esc(j.jobId)}')">View failures</button>` : ''}
              ${j.status === 'running' ? `<button class="btn btn-xs btn-ghost" onclick="watchBulkJob('${esc(j.jobId)}')">Watch</button>` : ''}
              ${(j.status === 'failed' && !j.dryRun) ? `<button class="btn btn-xs btn-warning" onclick="retryBulkJob('${esc(j.jobId)}')">Retry failed</button>` : ''}
            </div>
          </div>
          ${bar}
          <div class="text-xs opacity-60 mt-1">${esc(when)}${j.createdBy ? ' · ' + esc(j.createdBy) : ''}</div>
          ${diag.length ? `<div class="text-xs opacity-70 mt-1">${diag.join(' · ')}</div>` : ''}
        </div>`;
    }).join('');

    const more = data.total > (data.offset + data.limit);
    box.innerHTML += more
        ? `<div class="text-xs opacity-60 pt-1">Showing ${data.jobs.length} of ${data.total}.</div>`
        : '';
}

// The panel markup is delivered by htmx (hx-trigger="load once"), so it can
// arrive AFTER the section-switch code runs. Retry briefly instead of silently
// doing nothing when the container is not in the DOM yet.
function _waitForEl(id, tries = 20, delayMs = 150) {
    return new Promise(resolve => {
        let n = 0;
        const tick = () => {
            const el = document.getElementById(id);
            if (el) return resolve(el);
            if (++n >= tries) return resolve(null);
            setTimeout(tick, delayMs);
        };
        tick();
    });
}

async function loadBulkJobs(offset = 0) {
    const box = await _waitForEl('bulk-jobs-list');
    if (!box) return;                     // section never rendered; nothing to do
    try {
        const d = await api('GET', `/gws/bulk/jobs?limit=25&offset=${offset}`);
        renderBulkJobs(d);
    } catch (e) {
        box.innerHTML = `<div class="text-xs text-error py-2">Could not load jobs: ${esc(e.message)}</div>`;
    }
}

async function showBulkFailures(jobId) {
    const panel = await _waitForEl('bulk-job-failures');
    const list = panel && document.getElementById('bulk-job-failures-list');
    const title = panel && document.getElementById('bulk-job-failures-title');
    if (!panel || !list) return;
    panel.classList.remove('hidden');
    list.innerHTML = '<div class="text-xs opacity-60">Loading…</div>';
    try {
        // page through so a bad run with thousands of failures is fully visible
        const first = await api('GET', `/gws/bulk/failures?id=${encodeURIComponent(jobId)}&limit=500&offset=0`);
        let items = first.items.slice();
        let guard = 0;
        while (items.length < first.total && guard < 20) {
            const next = await api('GET', `/gws/bulk/failures?id=${encodeURIComponent(jobId)}&limit=500&offset=${items.length}`);
            if (!next.items.length) break;
            items = items.concat(next.items);
            guard++;
        }
        title.textContent = `${first.total} failure${first.total === 1 ? '' : 's'} in ${jobId}`;
        const trunc = items.length < first.total ? ` (showing first ${items.length})` : '';
        list.innerHTML = items.map(f =>
            `<div>${esc(f.email)} — <span class="text-error">${esc(f.error || 'unknown error')}</span>`
            + `${f.status ? ` <span class="opacity-50">[HTTP ${esc(String(f.status))}${f.reason ? ' ' + esc(f.reason) : ''}]</span>` : ''}</div>`
        ).join('') + (trunc ? `<div class="opacity-60 pt-1">${trunc}</div>` : '');
        notify(`Loaded ${items.length} failures`, 'info');
    } catch (e) {
        list.innerHTML = `<div class="text-error">Could not load failures: ${esc(e.message)}</div>`;
    }
}

async function retryBulkJob(jobId) {
    try {
        const r = await api('POST', '/gws/bulk/retry', { jobId });
        rememberBulkJob(r.jobId);
        showBulkProgress(r.total);
        pollBulkJob(r.jobId);
        loadBulkJobs();
    } catch (e) { notify(e.message, 'error'); }
}

// Re-attach to whatever job this browser last started, if it is still going.
async function resumeLastBulkJob() {
    const id = lastBulkJob();
    if (!id) { loadBulkJobs(); return; }
    try {
        const s = await api('GET', '/gws/bulk/status?id=' + encodeURIComponent(id));
        if (s.status === 'running') {
            rememberBulkJob(id);
            showBulkProgress(s.total);
            pollBulkJob(id);
        } else {
            rememberBulkJob(null);
        }
    } catch (_) {
        rememberBulkJob(null);   // job is gone (or the id is stale)
    }
    loadBulkJobs();
}

// Called when the Bulk Signatures section is shown.
function onBulkSectionShown() {
    resumeLastBulkJob();
}
