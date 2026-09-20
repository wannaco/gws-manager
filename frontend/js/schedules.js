// ── Signature schedules ──────────────────────────────────────────────────────
//
// Schedules apply a signature on a recurrence: daily / weekly / monthly /
// once / every N minutes. The recurrence is computed server-side in
// lib/helpers.js (nextRunAfter) from the rule plus the browser's UTC offset, so
// the UI never has to agree with the server about when something is due.
//
// TIMEZONE: the JSVM has no Intl, so IANA zones cannot be resolved server-side.
// The browser reports its current offset, which is exact for zones without DST.

window._schedules = [];
window._scheduleAudience = null;
window._editingScheduleId = null;

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function _browserOffsetMinutes() {
    // getTimezoneOffset() is minutes BEHIND UTC (UTC-6 -> +360), and we want the
    // signed offset used in local = utc + off (UTC-6 -> -360).
    return -new Date().getTimezoneOffset();
}

function _browserTimezoneName() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
    catch (_) { return ''; }
}

function _fmtLocal(iso, offsetMin) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (!t) return '—';
    // `iso` is UTC; render it in the schedule's own offset, not the viewer's
    const d = new Date(t + (offsetMin || 0) * 60000);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
           `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function _fmtAbsolute(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (!t) return '—';
    return new Date(t).toLocaleString();
}

function _describeRule(s) {
    const time = s.time || '09:00';
    switch (s.freq) {
        // render in the schedule's own offset, so it agrees with the "next run"
        // line below it rather than showing the same instant in two zones
        case 'once':     return `Once on ${_fmtLocal(s.startsAt, s.tzOffsetMinutes)}`;
        case 'weekly': {
            const days = (s.weekdays || []).slice().sort();
            const names = days.map(d => WEEKDAY_NAMES[d]).join(', ');
            return `Weekly on ${names || 'weekdays'} at ${time}`;
        }
        case 'monthly':  return `Monthly on day ${s.dayOfMonth || 1} at ${time}`;
        case 'interval': {
            const m = s.intervalMinutes || 60;
            const label = m >= 60 ? `${(m / 60).toFixed(m % 60 ? 1 : 0)} hour${m >= 120 ? 's' : ''}`
                                  : `${m} minutes`;
            return `Every ${label}`;
        }
        default:         return `Daily at ${time}`;
    }
}

function _scheduleStatusPill(s) {
    if (!s.enabled) return '<span class="badge badge-ghost badge-sm">paused</span>';
    if (s.lastStatus === 'success') return '<span class="badge badge-success badge-sm">ok</span>';
    if (s.lastStatus === 'failed') return '<span class="badge badge-error badge-sm">failed</span>';
    if (s.lastStatus === 'error') return '<span class="badge badge-warning badge-sm">error</span>';
    if (s.lastStatus === 'skipped') return '<span class="badge badge-info badge-sm">skipped</span>';
    if (s.lastStatus === 'queued') return '<span class="badge badge-info badge-sm">running</span>';
    return '<span class="badge badge-ghost badge-sm">new</span>';
}

async function loadSchedules() {
    const box = document.getElementById('schedules-list');
    if (!box) return;
    try {
        const d = await api('GET', '/gws/bulk/schedules');
        window._schedules = d.schedules || [];
        renderSchedules();
    } catch (e) {
        box.innerHTML = `<div class="text-sm text-error py-2">Could not load schedules: ${esc(e.message)}</div>`;
    }
}

function renderSchedules() {
    const box = document.getElementById('schedules-list');
    if (!box) return;
    const list = window._schedules;
    if (!list.length) {
        box.innerHTML = `<div class="text-sm opacity-60 py-6 text-center">
            No schedules yet. A schedule applies a signature automatically —
            pick the recipients, choose the signature, set the time.</div>`;
        return;
    }
    box.innerHTML = list.map(s => {
        const runs = s.runCount || 0;
        const ok = s.successRuns || 0;
        const bad = s.failedRuns || 0;
        return `
        <div class="gws-row" data-id="${esc(s.id)}">
          <div class="gws-row-main">
            <div class="gws-row-title">
              ${_scheduleStatusPill(s)}
              <span class="font-semibold">${esc(s.title)}</span>
            </div>
            ${s.description ? `<div class="gws-row-sub">${esc(s.description)}</div>` : ''}
            <div class="gws-row-sub">
              ${esc(_describeRule(s))}
              ${s.timezone ? ` · <span title="${esc(s.timezone)}">${esc(s.timezone)}</span>` : ''}
            </div>
            <div class="gws-row-sub">
              ${s.enabled
                 ? `Next run <strong>${esc(_fmtLocal(s.nextRunAt, s.tzOffsetMinutes))}</strong>`
                 : 'Paused'}
              ${runs ? ` · ${runs} run${runs === 1 ? '' : 's'}: <span class="text-success">${ok} ok</span>${bad ? `, <span class="text-error">${bad} failed</span>` : ''}` : ''}
              ${s.appliedUsers ? ` · ${s.appliedUsers} mailbox${s.appliedUsers === 1 ? '' : 'es'} updated` : ''}
            </div>
            ${s.lastError ? `<div class="gws-row-sub text-warning">${esc(s.lastError)}</div>` : ''}
          </div>
          <div class="gws-row-actions">
            <button class="btn btn-xs" onclick="runScheduleNow('${esc(s.id)}')">Run now</button>
            <button class="btn btn-xs" onclick="toggleSchedule('${esc(s.id)}')">${s.enabled ? 'Pause' : 'Resume'}</button>
            <button class="btn btn-xs" onclick="showScheduleRuns('${esc(s.id)}')">History</button>
            <button class="btn btn-xs" onclick="openScheduleEditor('${esc(s.id)}')">Edit</button>
            <button class="btn btn-xs btn-error btn-outline" onclick="deleteSchedule('${esc(s.id)}')">Delete</button>
          </div>
        </div>`;
    }).join('');
}

async function toggleSchedule(id) {
    try {
        const r = await api('POST', '/gws/bulk/schedules', { action: 'toggle', id });
        notify(r.schedule.enabled ? 'Schedule resumed' : 'Schedule paused', 'success');
        await loadSchedules();
    } catch (e) { notify(e.message, 'error'); }
}

async function deleteSchedule(id) {
    const s = window._schedules.find(x => x.id === id);
    if (!confirm(`Delete the schedule "${s ? s.title : id}"?\n\nRuns it already performed are kept in Bulk Jobs.`)) return;
    try {
        await api('POST', '/gws/bulk/schedules', { action: 'delete', id });
        notify('Schedule deleted', 'success');
        await loadSchedules();
    } catch (e) { notify(e.message, 'error'); }
}

async function runScheduleNow(id) {
    try {
        const r = await api('POST', '/gws/bulk/schedules', { action: 'runNow', id });
        notify(`Queued for ${r.total} recipient${r.total === 1 ? '' : 's'}`, 'success');
        await loadSchedules();
    } catch (e) { notify(e.message, 'error'); }
}

async function showScheduleRuns(id) {
    const panel = document.getElementById('schedule-runs');
    const list = document.getElementById('schedule-runs-list');
    const title = document.getElementById('schedule-runs-title');
    if (!panel || !list) return;
    const s = window._schedules.find(x => x.id === id);
    panel.classList.remove('hidden');
    list.innerHTML = '<div class="text-xs opacity-60">Loading…</div>';
    try {
        const d = await api('GET', '/gws/bulk/schedule-runs?id=' + encodeURIComponent(id));
        if (!d.runs.length) {
            title.textContent = `History — ${s ? s.title : id}`;
            list.innerHTML = '<div class="text-xs opacity-60">No runs yet.</div>';
            return;
        }
        title.textContent = `History — ${s ? s.title : id} (${d.runs.length})`;
        list.innerHTML = d.runs.map(r => `
            <div class="gws-row gws-row-tight">
              <div class="gws-row-main">
                <div class="text-xs">
                  <span class="badge badge-sm ${r.status === 'done' ? 'badge-success' : r.status === 'failed' ? 'badge-error' : 'badge-info'}">${esc(r.status)}</span>
                  <strong>${r.done} / ${r.total}</strong>
                  ${r.failedCount ? `<span class="text-error">${r.failedCount} failed</span>` : ''}
                </div>
                <div class="gws-row-sub">${esc(_fmtAbsolute(r.startedAt))}${r.finishedAt ? ' → ' + esc(_fmtAbsolute(r.finishedAt)) : ''}</div>
                ${r.lastError ? `<div class="gws-row-sub text-warning">${esc(r.lastError)}</div>` : ''}
              </div>
            </div>`).join('');
    } catch (e) {
        list.innerHTML = `<div class="text-xs text-error">Could not load history: ${esc(e.message)}</div>`;
    }
}

// ── editor ───────────────────────────────────────────────────────────────────

function _setRuleFields() {
    const freq = document.getElementById('sch-freq').value;
    // `once` has its own datetime-local field; `interval` has no time of day
    document.getElementById('sch-time-row').classList.toggle('hidden',
        freq === 'interval' || freq === 'once');
    document.getElementById('sch-weekdays-row').classList.toggle('hidden', freq !== 'weekly');
    document.getElementById('sch-dom-row').classList.toggle('hidden', freq !== 'monthly');
    document.getElementById('sch-interval-row').classList.toggle('hidden', freq !== 'interval');
    document.getElementById('sch-once-row').classList.toggle('hidden', freq !== 'once');
    _previewNextRun();
}

function _collectRule() {
    const freq = document.getElementById('sch-freq').value;
    const days = Array.from(document.querySelectorAll('.sch-day:checked')).map(c => parseInt(c.value, 10));
    return {
        freq,
        time: document.getElementById('sch-time').value || '09:00',
        weekdays: days,
        dayOfMonth: parseInt(document.getElementById('sch-dom').value, 10) || 1,
        intervalMinutes: parseInt(document.getElementById('sch-interval').value, 10) || 60,
        startsAt: document.getElementById('sch-once').value
            ? new Date(document.getElementById('sch-once').value).toISOString() : '',
        tzOffsetMinutes: _browserOffsetMinutes(),
        timezone: _browserTimezoneName(),
    };
}

// Mirrors nextRunAfter() for the daily/weekly/monthly/once cases, so the user can
// see exactly when it will next fire before saving. (The server remains the
// authority -- this is a preview.)
function _previewNextRun() {
    const el = document.getElementById('sch-preview');
    if (!el) return;
    const r = _collectRule();
    const note = document.getElementById('sch-tz-note');
    const off = r.tzOffsetMinutes;
    const sign = off <= 0 ? '-' : '+';
    const abs = Math.abs(off);
    if (note) note.textContent =
        `${_browserTimezoneName() || 'local'} (UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')})`;

    let next = null;
    const now = new Date();
    if (r.freq === 'once') {
        if (!r.startsAt) { el.textContent = 'Pick a date and time.'; return; }
        next = new Date(r.startsAt);
    } else if (r.freq === 'interval') {
        next = new Date(now.getTime() + r.intervalMinutes * 60000);
    } else {
        const [hh, mm] = (r.time || '09:00').split(':').map(Number);
        const cand = new Date(now);
        cand.setSeconds(0, 0);
        cand.setHours(hh, mm, 0, 0);
        let guard = 0;
        const matchesDay = d => {
            if (r.freq === 'weekly') {
                const wd = r.weekdays.length ? r.weekdays : [1, 2, 3, 4, 5];
                return wd.includes(d.getDay());
            }
            if (r.freq === 'monthly') {
                const dom = r.dayOfMonth || 1;
                const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                return d.getDate() === Math.min(dom, last);
            }
            return true;
        };
        while (guard++ < 400 && (cand <= now || !matchesDay(cand))) {
            cand.setDate(cand.getDate() + 1);
        }
        next = cand;
    }
    const t = next.getTime();
    const rel = t - now.getTime();
    const mins = Math.round(rel / 60000);
    const relTxt = mins < 60 ? `in ${mins} min`
        : mins < 1440 ? `in ${Math.round(mins / 60)} h`
        : `in ${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? '' : 's'}`;
    el.textContent = `Next run ${next.toLocaleString()} (${relTxt})`;
}

function onScheduleAudiencePicked() {
    const a = window._scheduleAudience;
    const el = document.getElementById('sch-audience-label');
    if (el) {
        el.textContent = a && a.count
            ? `${a.count} recipient${a.count === 1 ? '' : 's'}`
            : 'No recipients selected';
        el.classList.toggle('opacity-60', !(a && a.count));
    }
}

async function openScheduleEditor(id) {
    const overlay = document.getElementById('schedule-editor');
    if (!overlay) return;
    window._editingScheduleId = id || null;
    const s = id ? window._schedules.find(x => x.id === id) : null;

    document.getElementById('sch-editor-title').textContent = s ? 'Edit schedule' : 'New schedule';
    document.getElementById('sch-title').value = s ? s.title : '';
    document.getElementById('sch-description').value = s ? s.description : '';
    document.getElementById('sch-freq').value = s ? s.freq : 'daily';
    document.getElementById('sch-time').value = s ? (s.time || '09:00') : '09:00';
    document.getElementById('sch-dom').value = s ? (s.dayOfMonth || 1) : 1;
    document.getElementById('sch-interval').value = s ? (s.intervalMinutes || 60) : 60;
    document.getElementById('sch-once').value = (s && s.startsAt)
        ? new Date(new Date(s.startsAt).getTime() - (s.tzOffsetMinutes || 0) * 60000)
              .toISOString().slice(0, 16)
        : '';
    const days = s ? (s.weekdays || []) : [1, 2, 3, 4, 5];
    document.querySelectorAll('.sch-day').forEach(c =>
        c.checked = days.includes(parseInt(c.value, 10)));

    // signature picker
    const sel = document.getElementById('sch-template');
    sel.innerHTML = '<option value="">— editor content below —</option>';
    try {
        const t = await api('GET', '/gws/signature-templates');
        sel.innerHTML += (t.templates || []).map(x =>
            `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    } catch (_) {}
    if (s && s.templateId) sel.value = s.templateId;

    // inline editor
    window._scheduleEditor = null;
    const host = document.getElementById('sch-editor-html');
    host.innerHTML = '';
    setTimeout(() => {
        window._scheduleEditor = grapesjs.init({
            container: host, fromElement: false, height: '220px', width: '100%',
            storageManager: { type: 'none' },
            canvas: { styles: ['body { font-family: sans-serif; font-size:14px; }'] },
        });
        if (s && s.hasInlineHtml) {
            // the list payload omits the html (it can be large) -- fetch it
            api('GET', '/gws/bulk/schedules?id=' + encodeURIComponent(s.id))
                .then(full => {
                    const html = (full.schedule && full.schedule.html) || '';
                    if (html && window._scheduleEditor) {
                        window._scheduleEditor.setComponents(cleanHtmlString(html));
                    }
                })
                .catch(() => {});
        }
    }, 50);

    // audience
    window._scheduleAudience = (s && s.selector)
        ? { selector: s.selector, emails: [], count: 0 } : null;
    if (s && s.selector) {
        try {
            const r = await api('POST', '/gws/audience/resolve', s.selector);
            window._scheduleAudience.emails = r.emails || [];
            window._scheduleAudience.count = r.count || 0;
        } catch (_) {}
    }
    onScheduleAudiencePicked();

    const err = document.getElementById('sch-error');
    err.classList.add('hidden');
    err.textContent = '';
    _setRuleFields();
    overlay.classList.remove('hidden');
}

function closeScheduleEditor() {
    const overlay = document.getElementById('schedule-editor');
    if (overlay) overlay.classList.add('hidden');
    if (window._scheduleEditor) {
        try { window._scheduleEditor.destroy(); } catch (_) {}
        window._scheduleEditor = null;
    }
}

async function saveSchedule() {
    const err = document.getElementById('sch-error');
    const showErr = m => { err.textContent = m; err.classList.remove('hidden'); };

    const title = document.getElementById('sch-title').value.trim();
    if (!title) return showErr('Give the schedule a title.');

    const templateId = document.getElementById('sch-template').value;
    let html = '';
    if (!templateId && window._scheduleEditor) {
        html = cleanEditorOutput(window._scheduleEditor);
        if (_isEffectivelyEmpty(html)) html = '';
    }
    if (!templateId && !html) {
        return showErr('This schedule has no signature — pick a saved template or build one in the editor.');
    }
    if (!window._scheduleAudience || !window._scheduleAudience.count) {
        return showErr('Choose who it applies to first (Choose recipients).');
    }
    const rule = _collectRule();
    if (rule.freq === 'once' && !rule.startsAt) {
        return showErr('Pick the date and time for a one-off schedule.');
    }
    if (rule.freq === 'weekly' && !rule.weekdays.length) {
        return showErr('Pick at least one day of the week.');
    }

    const body = Object.assign({
        action: window._editingScheduleId ? 'update' : 'create',
        id: window._editingScheduleId || undefined,
        title,
        description: document.getElementById('sch-description').value.trim(),
        templateId: templateId || '',
        html: html || '',
        selector: window._scheduleAudience.selector,
        enabled: true,
    }, rule);

    try {
        await api('POST', '/gws/bulk/schedules', body);
        notify(window._editingScheduleId ? 'Schedule saved' : 'Schedule created', 'success');
        closeScheduleEditor();
        await loadSchedules();
    } catch (e) { showErr(e.message); }
}

function onSchedulesSectionShown() {
    // day-of-month options are generated rather than hardcoded in the markup
    const dom = document.getElementById('sch-dom');
    if (dom && !dom.options.length) {
        for (let d = 1; d <= 31; d++) {
            const o = document.createElement('option');
            o.value = d;
            o.textContent = d + (d === 31 ? ' (or last day of shorter months)' : '');
            dom.appendChild(o);
        }
    }
    loadSchedules();
}
