window._sigEd = null;

var PHOTO_PLACEHOLDER_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">' +
  '<rect width="72" height="72" rx="36" fill="#e2e8f0"/>' +
  '<circle cx="36" cy="27" r="11" fill="#94a3b8"/>' +
  '<path d="M16 60c0-11 9-18 20-18s20 7 20 18" fill="#94a3b8"/>' +
  '</svg>'
);

function createSignatureEditor(container, initialHtml, opts) {
  var el = typeof container === 'string' ? document.querySelector(container) : container;
  if (!el) return null;
  el.innerHTML = '';
  var ta = document.createElement('textarea');
  el.appendChild(ta);

  var options = opts || {};
  var editor = SUNEDITOR.create(ta, {
    width: '100%',
    height: options.height || '260px',
    minHeight: options.minHeight || '180px',
    defaultStyle: 'font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222222;',
    resizingBar: false,
    showPathLabel: false,
    buttonList: [
      ['undo', 'redo'],
      ['font', 'fontSize', 'formatBlock'],
      ['bold', 'underline', 'italic', 'strike', 'removeFormat'],
      ['fontColor', 'hiliteColor'],
      ['align', 'list', 'lineHeight'],
      ['table', 'link', 'image'],
      ['codeView']
    ],
    attributesWhitelist: {
      all: 'style|class|id|width|height|align|valign|cellpadding|cellspacing|border|bgcolor|data-gws-src'
    }
  });

  if (initialHtml) {
    setEditorHtml(editor, cleanHtmlString(initialHtml));
  }
  return editor;
}

function setEditorHtml(editor, html) {
  if (!editor) return;
  editor.setContents(html || '');
}

function getEditorHtml(editor) {
  if (!editor) return '';
  var html = editor.getContents(true) || '';
  var stripped = html.replace(/<p><br\s*\/?><\/p>/gi, '').trim();
  if (!stripped) return '';
  return cleanEmailHtml(html);
}

// Keep cleanEditorOutput as an alias for callers across bulk.js / schedules.js
function cleanEditorOutput(editor) {
  return getEditorHtml(editor);
}

// Ensure tables/images in signature HTML stay Gmail-friendly, and restore any
// {{photoUrl}} placeholder images from their editor preview data-URI.
function cleanEmailHtml(html) {
  if (!html) return '';
  var wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  wrapper.querySelectorAll('img[data-gws-src]').forEach(function(img) {
    img.setAttribute('src', img.getAttribute('data-gws-src'));
    img.removeAttribute('data-gws-src');
  });
  wrapper.querySelectorAll('table').forEach(function(t) {
    if (!t.style.borderCollapse) t.style.borderCollapse = 'collapse';
    var sw = (t.style.width || '').trim();
    var aw = (t.getAttribute('width') || '').trim();
    // Standard email signature practice: never let a table stretch 100% across
    // wide monitors. Convert percentage or missing widths to fixed 520px.
    if (!sw || /%$/.test(sw) || /%$/.test(aw)) {
      t.style.width = '520px';
      t.style.maxWidth = '100%';
      t.setAttribute('width', '520');
    }
  });
  wrapper.querySelectorAll('p').forEach(function(p) {
    if (!p.style.margin && p.closest && p.closest('td, th')) {
      p.style.margin = '0';
    }
  });
  return wrapper.innerHTML;
}

// Strip legacy GrapesJS structural wrappers when loading older saved templates,
// and swap src="{{photoUrl}}" to an inline avatar preview for the editor canvas.
function cleanHtmlString(html) {
  if (!html) return html;
  var hasLegacy = html.indexOf('gjs-') !== -1 || html.indexOf('<colgroup') !== -1;
  var hasPhotoToken = html.indexOf('{{photoUrl}}') !== -1;
  if (!hasLegacy && !hasPhotoToken) return html;
  var parser = new DOMParser();
  var doc = parser.parseFromString(html, 'text/html');
  if (hasLegacy) {
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
      if (el.className && typeof el.className === 'string') {
        el.className = el.className.split(/\s+/).filter(function(c) { return c.indexOf('gjs-') !== 0; }).join(' ');
        if (!el.className) el.removeAttribute('class');
      }
      if (el.id && /^i[a-z0-9]{5,}$/.test(el.id)) el.removeAttribute('id');
    });
    doc.querySelectorAll('colgroup, col').forEach(function(el) { el.remove(); });
  }
  doc.querySelectorAll('img').forEach(function(img) {
    var src = img.getAttribute('src') || '';
    if (src.indexOf('{{photoUrl}}') !== -1) {
      img.setAttribute('data-gws-src', src);
      img.setAttribute('src', PHOTO_PLACEHOLDER_SVG);
    }
  });
  return doc.body ? doc.body.innerHTML : html;
}

function killSig() {
  if (window._sigEd) {
    try { window._sigEd.destroy(); } catch (_) {}
    window._sigEd = null;
  }
  if (window._vacEd) {
    try { window._vacEd.destroy(); } catch (_) {}
    window._vacEd = null;
  }
}

function mkSig(html) {
  killSig();
  var el = document.getElementById('sig-editor');
  if (!el) return;
  window._sigEd = createSignatureEditor(el, html || '', { height: '260px' });
}

function getSig() {
  return window._sigEd ? getEditorHtml(window._sigEd) : '';
}

function insertPlaceholder(tag, target) {
  var ed = null;
  if (target === 'sig') ed = window._sigEd;
  else if (target === 'bulk') ed = window._bulkEditor;
  else if (target === 'schedule') ed = window._scheduleEditor;
  else ed = window._sigEd || window._bulkEditor || window._scheduleEditor;
  if (!ed) return;
  if (tag === '{{photoUrl}}') {
    var imgStyle = 'width:72px;height:72px;border-radius:50%;object-fit:cover;';
    if (target === 'sig' && window._detailUser && window._detailUser.photoUrl) {
      ed.insertHTML('<img src="' + esc(window._detailUser.photoUrl) + '" alt="' + esc(window._detailUser.name || 'Photo') + '" style="' + imgStyle + '">', true, true);
    } else {
      ed.insertHTML('<img src="' + PHOTO_PLACEHOLDER_SVG + '" data-gws-src="{{photoUrl}}" alt="Photo" style="' + imgStyle + '">', true, true);
      if (target === 'sig') notify('No photo URL cached for this user — inserted {{photoUrl}} placeholder', 'info');
    }
    return;
  }
  ed.insertHTML(tag, true, true);
}
