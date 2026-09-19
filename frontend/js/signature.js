window._sigEd = null;

function killSig() { if (window._sigEd) { window._sigEd.destroy(); window._sigEd = null; } }

function mkSig(html) {
  killSig();
  var el = document.getElementById('sig-editor');
  if (!el) return;
  _sigEd = grapesjs.init({
    container: el,
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
  const sigPanel = _sigEd.Panels.getPanel('options');
  if (sigPanel) {
    sigPanel.get('buttons').remove(sigPanel.get('buttons').where({ command: 'export-template' }));
    sigPanel.get('buttons').remove(sigPanel.get('buttons').where({ id: 'export-template' }));
  }

  // Add HTML editor button to signature editor
  _sigEd.Panels.addButton('options', {
    id: 'sig-open-code',
    className: 'fa fa-code',
    command: 'gjs-open-code',
    attributes: { title: 'Edit HTML' }
  });
  
  // Register the command to open the signature code editor
  _sigEd.Commands.add('gjs-open-code', {
    run: function(editor, sender) {
      sender && sender.set('active', 0);
      openCodeEditor();
    }
  });
  
  if (html) {
    // Strip GrapesJS structural cruft from saved signatures before loading
    html = cleanHtmlString(html);
    _sigEd.setComponents(html);
  }
}

function escForCode(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function createEnhancedCodeEditor(editor, title) {
  // Show cleaned HTML so users don't see GrapesJS structural cruft
  const raw = cleanHtmlString(editor.getHtml());
  // Also show user-defined CSS only
  const rawCss = editor.getCss().replace(/\.gjs-[a-z-]+\s*\{[^}]*\}/g, '').replace(/#i[a-z0-9]+\s*\{[^}]*\}/g, '').replace(/body\s*\{[^}]*\}/g, '').trim();
  const code = rawCss ? raw + '\n<style>\n' + rawCss + '\n</style>' : raw;
  
  editor.Modal.setTitle(title)
    .setContent(`
      <div class="code-editor-wrapper">
        <div class="code-editor-actions">
          <button class="btn btn-primary btn-sm" onclick="updateCode('${editor === window._sigEd ? '_sigEd' : '_bulkEditor'}')">Update</button>
          <button class="btn btn-ghost btn-sm" onclick="closeCodeEditorModal('${editor === window._sigEd ? '_sigEd' : '_bulkEditor'}')">Close</button>
        </div>
        <textarea id="enhanced-code-editor" class="code-editor-textarea">${escForCode(code)}</textarea>
      </div>
    `)
    .open();
}

function updateCode(editorName) {
  const code = document.getElementById('enhanced-code-editor').value;
  const editor = editorName === '_sigEd' ? window._sigEd : window._bulkEditor;
  editor.setComponents(code);
  editor.Modal.close();
}

function closeCodeEditorModal(editorName) {
  const editor = editorName === '_sigEd' ? window._sigEd : window._bulkEditor;
  editor.Modal.close();
}

function openCodeEditor() {
    try {
        createEnhancedCodeEditor(window._sigEd, 'Edit HTML');
    } catch(e) {
        alert('openCodeEditor error: ' + e.message);
    }
}

function openBulkCodeEditor() {
    try {
        createEnhancedCodeEditor(window._bulkEditor, 'Edit HTML (Bulk)');
    } catch(e) {
        alert('openBulkCodeEditor error: ' + e.message);
    }
}

function getSig() { return window._sigEd ? cleanEditorOutput(window._sigEd) : ''; }

// ── Strip GrapesJS structural cruft from a raw HTML string (used for loading) ──
function cleanHtmlString(html) {
    if (!html) return html;
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');
    var changed = true;
    while (changed) {
        changed = false;
        ['gjs-cell', 'gjs-row'].forEach(function(cls) {
            doc.querySelectorAll('.' + cls).forEach(function(el) {
                var parent = el.parentNode;
                while (el.firstChild) parent.insertBefore(el.firstChild, el);
                parent.removeChild(el);
                changed = true;
            });
        });
    }
    doc.querySelectorAll('*').forEach(function(el) {
        if (el.className) {
            el.className = el.className.split(/\s+/).filter(function(c) { return c.indexOf('gjs-') !== 0; }).join(' ');
            if (!el.className) el.removeAttribute('class');
        }
        if (el.id && /^i[a-z0-9]{5,}$/.test(el.id)) el.removeAttribute('id');
    });
    // Remove GrapesJS table cruft and empty/trailing paragraph noise
    doc.querySelectorAll('colgroup, col').forEach(function(el) { el.remove(); });
    doc.querySelectorAll('td, th, tr').forEach(function(el) {
        if (el.getAttribute('colspan') === '1') el.removeAttribute('colspan');
        if (el.getAttribute('rowspan') === '1') el.removeAttribute('rowspan');
    });
    doc.querySelectorAll('p').forEach(function(el) {
        var txt = (el.textContent || '').trim();
        var hasImg = el.querySelector('img, table, h1, h2, h3, h4, h5, h6, ul, ol');
        if (!txt && !hasImg) el.remove();
        // Unstyled paragraphs inside table cells cause Gmail's default 1em margins — compact them
        if (!hasImg && !el.style.margin && el.closest && el.closest('td, th')) el.style.margin = '0';
    });
    return doc.body ? doc.body.innerHTML : html;
}

// ── Strip GrapesJS structural cruft from editor output ──
// GrapesJS wraps content in <div class="gjs-row"><div class="gjs-cell">...</div></div>
// and generates CSS rules for those structural divs. Gmail can't render them — strip.
function cleanEditorOutput(editor) {
    var html = editor.getHtml();
    var css  = editor.getCss();

    // 1. Parse HTML and unwrap GrapesJS structural wrappers
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');

    // Unwrap gjs-cell and gjs-row divs — keep only their children
    var changed = true;
    while (changed) {
        changed = false;
        ['gjs-cell', 'gjs-row'].forEach(function(cls) {
            doc.querySelectorAll('.' + cls).forEach(function(el) {
                var parent = el.parentNode;
                while (el.firstChild) parent.insertBefore(el.firstChild, el);
                parent.removeChild(el);
                changed = true;
            });
        });
    }

    // 2. Strip gjs-* classes and auto-generated IDs from remaining elements
    doc.querySelectorAll('*').forEach(function(el) {
        // Strip all gjs-* classes
        if (el.className) {
            el.className = el.className.split(/\s+/).filter(function(c) {
                return c.indexOf('gjs-') !== 0;
            }).join(' ');
            if (!el.className) el.removeAttribute('class');
        }
        // Strip auto-generated GrapesJS IDs (pattern: i + random alphanumeric)
        if (el.id && /^i[a-z0-9]{5,}$/.test(el.id)) {
            el.removeAttribute('id');
        }
        // Remove GrapesJS table cruft: colgroup/col, colspan=1/rowspan=1
        if (el.tagName === 'COLGROUP' || el.tagName === 'COL') {
            el.remove(); return;
        }
        if (el.tagName === 'TD' || el.tagName === 'TH' || el.tagName === 'TR') {
            if (el.getAttribute('colspan') === '1') el.removeAttribute('colspan');
            if (el.getAttribute('rowspan') === '1') el.removeAttribute('rowspan');
        }
    });

    // Remove empty paragraphs and <p><br></p>/<p><a><br></a></p> trailing noise,
    // and compact unstyled paragraphs inside table cells (Gmail default p margin = huge gaps)
    doc.querySelectorAll('p').forEach(function(el) {
        var txt = (el.textContent || '').trim();
        var hasBlock = el.querySelector('img, table, h1, h2, h3, h4, h5, h6, ul, ol');
        if (!txt && !hasBlock) { el.remove(); return; }
        if (!hasBlock && !el.style.margin && el.closest && el.closest('td, th')) {
            el.style.margin = '0';
        }
    });

    // 3. Clean CSS: remove GrapesJS structural rules (keep user-defined only)
    css = css.replace(/\.gjs-[a-z-]+\s*\{[^}]*\}/g, '');
    css = css.replace(/#i[a-z0-9]+\s*\{[^}]*\}/g, '');
    css = css.replace(/body\s*\{[^}]*\}/g, '');  // canvas body styles
    // Remove leftover blank lines
    css = css.replace(/^\s*\n/gm, '').trim();

    var cleanHtml = doc.body ? doc.body.innerHTML : html;

    // 4. Make email/Gmail-safe
    var wrapper = document.createElement('div');
    wrapper.innerHTML = cleanHtml;
    // Force tables to stretch full-width (Gmail won't otherwise)
    wrapper.querySelectorAll('table').forEach(function(t) {
      t.setAttribute('width', '100%');
      t.style.width = '100%';
    });
    // Strip any fixed pixel widths GrapesJS baked into cells (causes narrow squeeze)
    wrapper.querySelectorAll('td, th, col').forEach(function(el) {
      var w = el.style.width || el.getAttribute('width') || '';
      if (/^\d+px$/.test(w)) {
        el.style.width = '';
        el.removeAttribute('width');
      }
    });
    cleanHtml = wrapper.innerHTML;

    if (css) return cleanHtml + '<style>' + css + '</style>';
    return cleanHtml;
}

function insertPlaceholder(tag) {
  if (window._sigEd) {
    var comp = window._sigEd.DomComponents.addComponent({ type: 'text', content: tag });
    window._sigEd.getWrapper().append(comp);
  } else if (window._bulkEditor) {
    var comp = window._bulkEditor.DomComponents.addComponent({ type: 'text', content: tag });
    window._bulkEditor.getWrapper().append(comp);
  }
}
