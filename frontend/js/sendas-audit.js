// ── Read-Only Send-As Preflight Audit & In-App Help Guide ────────────────────

window._auditState = { running: false, cancelled: false, items: [], filter: 'all' };

async function runSendAsAudit() {
  var recipients = window._bulkRecipients || [];
  if (!recipients.length) {
    notify('Choose recipients first before running a Send-As check', 'warning');
    return;
  }

  window._auditState = { running: true, cancelled: false, items: [], filter: 'all' };
  var box = $('modal-box');
  box.className = 'bg-base-100 border border-base-300 rounded-2xl shadow-2xl w-full max-w-4xl p-6 fade-in max-h-[90vh] overflow-y-auto';
  $('modal-overlay').classList.remove('hidden');

  renderAuditModal(0, recipients.length);

  var batchSize = 20;
  for (var i = 0; i < recipients.length; i += batchSize) {
    if (window._auditState.cancelled) break;
    var chunk = recipients.slice(i, i + batchSize);
    try {
      var r = await api('POST', '/gws/bulk/sendas-audit', { emails: chunk });
      if (r && Array.isArray(r.items)) {
        window._auditState.items = window._auditState.items.concat(r.items);
      }
    } catch (e) {
      chunk.forEach(function(em) {
        window._auditState.items.push({
          email: em, status: 'error', defaultSendAs: '', verificationStatus: '', aliasCount: 0, aliases: [], error: e.message
        });
      });
    }
    renderAuditModal(Math.min(i + chunk.length, recipients.length), recipients.length);
  }

  window._auditState.running = false;
  renderAuditModal(window._auditState.items.length, recipients.length);
}

function cancelSendAsAudit() {
  window._auditState.cancelled = true;
  window._auditState.running = false;
  closeModal();
  // Reset modal-box width back to default
  var box = $('modal-box');
  if (box) box.className = 'bg-base-100 rounded-box shadow-2xl w-full max-w-md p-6 fade-in max-h-[90vh] overflow-y-auto';
}

function setAuditFilter(f) {
  window._auditState.filter = f;
  renderAuditTable();
}

function renderAuditModal(done, total) {
  var box = $('modal-box');
  if (!box) return;
  var st = window._auditState;
  var items = st.items;
  var okCount = items.filter(x => x.status === 'ok').length;
  var mismatchCount = items.filter(x => x.status === 'mismatch').length;
  var unverifiedCount = items.filter(x => x.status === 'unverified').length;
  var errCount = items.filter(x => x.status === 'error').length;
  var multiAliasCount = items.filter(x => x.aliasCount > 1).length;
  var pct = total ? Math.round((done / total) * 100) : 0;

  box.innerHTML = `
    <div class="flex items-start justify-between gap-4 mb-4">
      <div>
        <h3 class="font-bold text-lg">Send-As Preflight Report</h3>
        <p class="text-xs opacity-60">Read-only check of each recipient's default Send-As address and verification status (no signatures modified).</p>
      </div>
      <button class="btn btn-sm btn-ghost" onclick="cancelSendAsAudit()">✕</button>
    </div>

    ${st.running ? `
      <div class="mb-4">
        <div class="flex justify-between text-xs mb-1">
          <span>Checking ${done} of ${total} recipients…</span>
          <span class="font-mono">${pct}%</span>
        </div>
        <progress class="progress progress-primary w-full" value="${pct}" max="100"></progress>
      </div>
    ` : ''}

    <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4 text-center">
      <div class="border border-base-300 rounded-lg p-2">
        <div class="text-lg font-bold">${items.length}</div>
        <div class="text-xs opacity-60">Checked</div>
      </div>
      <div class="border border-base-300 rounded-lg p-2">
        <div class="text-lg font-bold text-success">${okCount}</div>
        <div class="text-xs opacity-60">Exact Match</div>
      </div>
      <div class="border border-base-300 rounded-lg p-2">
        <div class="text-lg font-bold text-info">${mismatchCount}</div>
        <div class="text-xs opacity-60">Alias Default</div>
      </div>
      <div class="border border-base-300 rounded-lg p-2">
        <div class="text-lg font-bold text-warning">${unverifiedCount}</div>
        <div class="text-xs opacity-60">Unverified</div>
      </div>
      <div class="border border-base-300 rounded-lg p-2">
        <div class="text-lg font-bold text-error">${errCount}</div>
        <div class="text-xs opacity-60">Errors</div>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div class="flex flex-wrap gap-1.5">
        <button class="btn btn-xs ${st.filter === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="setAuditFilter('all')">All (${items.length})</button>
        <button class="btn btn-xs ${st.filter === 'issues' ? 'btn-primary' : 'btn-outline'}" onclick="setAuditFilter('issues')">Issues (${unverifiedCount + errCount})</button>
        <button class="btn btn-xs ${st.filter === 'mismatch' ? 'btn-primary' : 'btn-outline'}" onclick="setAuditFilter('mismatch')">Alias Default (${mismatchCount})</button>
        <button class="btn btn-xs ${st.filter === 'multi' ? 'btn-primary' : 'btn-outline'}" onclick="setAuditFilter('multi')">Multiple Aliases (${multiAliasCount})</button>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-xs btn-outline" onclick="downloadSendAsCsv()" ${items.length ? '' : 'disabled'}>Export CSV</button>
      </div>
    </div>

    <div id="audit-table-wrap" class="border border-base-300 rounded-lg max-h-[45vh] overflow-y-auto"></div>

    <div class="modal-action mt-4">
      <button class="btn btn-sm" onclick="cancelSendAsAudit()">${st.running ? 'Stop & Close' : 'Close'}</button>
    </div>
  `;

  renderAuditTable();
}

function renderAuditTable() {
  var wrap = document.getElementById('audit-table-wrap');
  if (!wrap) return;
  var st = window._auditState;
  var list = st.items.filter(function(x) {
    if (st.filter === 'issues') return x.status === 'unverified' || x.status === 'error';
    if (st.filter === 'mismatch') return x.status === 'mismatch';
    if (st.filter === 'multi') return x.aliasCount > 1;
    return true;
  });

  if (!list.length) {
    wrap.innerHTML = '<div class="text-xs opacity-60 text-center py-8">No matching recipients.</div>';
    return;
  }

  wrap.innerHTML = `
    <table class="table table-xs w-full">
      <thead>
        <tr>
          <th>User</th>
          <th>Default Send-As</th>
          <th>Status</th>
          <th>Aliases</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(function(x) {
          var badge = x.status === 'ok' ? '<span class="badge badge-success badge-xs">OK</span>'
            : x.status === 'mismatch' ? '<span class="badge badge-info badge-xs">Alias default</span>'
            : x.status === 'unverified' ? '<span class="badge badge-warning badge-xs">Unverified</span>'
            : '<span class="badge badge-error badge-xs">Error</span>';
          var aliasList = (x.aliases || []).map(a => esc(a.sendAsEmail)).join(', ');
          return `
            <tr>
              <td class="font-mono">${esc(x.email)}</td>
              <td class="font-mono">${esc(x.defaultSendAs || '—')}</td>
              <td>${badge}${x.error ? `<div class="text-[11px] text-error mt-0.5">${esc(x.error)}</div>` : ''}</td>
              <td class="text-xs opacity-75">${x.aliasCount > 1 ? `${x.aliasCount}: ${aliasList}` : (x.aliasCount || 0)}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function downloadSendAsCsv() {
  var items = window._auditState.items || [];
  if (!items.length) return;
  var rows = [['email', 'status', 'defaultSendAs', 'verificationStatus', 'aliasCount', 'aliases', 'error']];
  items.forEach(function(x) {
    var aliases = (x.aliases || []).map(a => a.sendAsEmail).join('; ');
    rows.push([x.email, x.status, x.defaultSendAs, x.verificationStatus, String(x.aliasCount), aliases, x.error || '']);
  });
  var csv = rows.map(r => r.map(v => '"' + String(v || '').replace(/"/g, '""') + '"').join(',')).join('\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'sendas-preflight-report.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function openSendAsHelpModal() {
  var box = $('modal-box');
  box.className = 'bg-base-100 border border-base-300 rounded-2xl shadow-2xl w-full max-w-2xl p-6 fade-in max-h-[90vh] overflow-y-auto';
  box.innerHTML = `
    <div class="flex items-start justify-between gap-4 mb-4">
      <div>
        <h3 class="font-bold text-lg">How Signatures &amp; Send-As Aliases Work</h3>
        <p class="text-xs opacity-60">Quick reference for bulk signature rollouts and alias management.</p>
      </div>
      <button class="btn btn-sm btn-ghost" onclick="cancelSendAsAudit()">✕</button>
    </div>

    <div class="space-y-4 text-sm">
      <div class="gws-panel">
        <div class="font-semibold mb-1">1. Signatures belong to Send-As addresses</div>
        <p class="text-xs opacity-80 leading-relaxed">
          Gmail stores each signature on a specific <strong>Send-As</strong> alias rather than on the user account itself.
          During <strong>Bulk Apply</strong> and <strong>Schedules</strong>, GWS Admin automatically looks up each user's
          <strong>default verified Send-As address</strong> and applies the signature there.
        </p>
      </div>

      <div class="gws-panel">
        <div class="font-semibold mb-1">2. Secondary aliases are not overwritten in bulk</div>
        <p class="text-xs opacity-80 leading-relaxed">
          If a user also sends from extra aliases (such as <code>support@</code> or <code>sales@</code>), bulk apply leaves
          those secondary aliases untouched. To edit a signature for a specific alias, open <strong>GWS Users → select user → Signatures</strong>
          and choose the alias from the address dropdown.
        </p>
      </div>

      <div class="gws-panel">
        <div class="font-semibold mb-1">3. Managing Send-As aliases &amp; fixing <code>SEND_AS_UNVERIFIED</code></div>
        <p class="text-xs opacity-80 leading-relaxed">
          Send-As alias creation and removal is per-user under <strong>GWS Users → select user → Send As</strong>.
          Use <strong>Check Send-As</strong> on the Bulk Signatures page before a large rollout to spot any users whose default
          Send-As address is unverified or differs from their primary email.
        </p>
      </div>

      <div class="gws-callout">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        <span class="text-xs"><strong>No extra API scopes needed:</strong> Send-As checks use the existing <code>gmail.settings.basic</code> and <code>gmail.settings.sharing</code> scopes already configured for domain-wide delegation.</span>
      </div>
    </div>

    <div class="modal-action mt-5">
      <button class="btn btn-primary btn-sm" onclick="cancelSendAsAudit()">Got it</button>
    </div>
  `;
  $('modal-overlay').classList.remove('hidden');
}
