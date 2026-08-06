/* ═══════════════════════════════════════════════════════════════════════════
   LuzGlass — Icon set
   Lucide-style 24x24 stroke icons, embedded. No CDN.

   Usage:  <span data-icon="package"></span>
           <button ...><span data-icon="trash"></span><span>מחק</span></button>

   Icons inherit currentColor and font-size (see [data-icon] in lg-ui.css),
   so they follow the design tokens automatically.

   Icon-only controls MUST carry an accessible name:
           <button aria-label="מחק"><span data-icon="trash"></span></button>
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  // Path data only — the wrapper <svg> is added by render().
  var P = {
    /* navigation & views */
    'kanban':      '<rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="11" rx="1"/>',
    'list':        '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    'factory':     '<path d="M2 20h20V9l-6 4V9l-6 4V4H4l-2 16Z"/><line x1="7" y1="20" x2="7" y2="16"/><line x1="12" y1="20" x2="12" y2="16"/><line x1="17" y1="20" x2="17" y2="16"/>',
    'search':      '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.7" y2="16.7"/>',
    'pencil':      '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    'ruler':       '<path d="M3 15 15 3l6 6L9 21Z"/><path d="m7 11 2 2"/><path d="m11 7 2 2"/><path d="m5 13 1.5 1.5"/>',
    'calendar':    '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
    'chart':       '<line x1="4" y1="21" x2="4" y2="10"/><line x1="10" y1="21" x2="10" y2="4"/><line x1="16" y1="21" x2="16" y2="14"/><line x1="21" y1="21" x2="3" y2="21"/>',
    'wallet':      '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2Z"/><circle cx="17" cy="14" r="1"/>',
    'user':        '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    'users':       '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M17 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5a7 7 0 0 1 4 6.5"/>',
    'logout':      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    'settings':    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',

    /* objects & status */
    'package':     '<path d="m12 2 9 5v10l-9 5-9-5V7Z"/><path d="m3 7 9 5 9-5"/><line x1="12" y1="12" x2="12" y2="22"/>',
    'truck':       '<path d="M14 17V5a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 8h4l3 4v4a1 1 0 0 1-1 1h-1"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/><line x1="8.5" y1="17.5" x2="15.5" y2="17.5"/>',
    'receipt':     '<path d="M4 2v20l2.5-1.5L9 22l2.5-1.5L14 22l2.5-1.5L19 22V2l-2.5 1.5L14 2l-2.5 1.5L9 2 6.5 3.5Z"/><line x1="8" y1="8" x2="15" y2="8"/><line x1="8" y1="12" x2="15" y2="12"/>',
    'image':       '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    'file':        '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z"/><polyline points="14 2 14 7 19 7"/>',
    'clipboard':   '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    'paperclip':   '<path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5"/>',
    'trash':       '<polyline points="3 6 21 6"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    'download':    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    'lock':        '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'key':         '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3"/><path d="m17 5 3 3"/><path d="m14 8 3 3"/>',
    'bolt':        '<circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
    'scissors':    '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.1" y2="15.9"/><line x1="14.5" y1="14.5" x2="20" y2="20"/><line x1="8.1" y1="8.1" x2="12" y2="12"/>',
    'flame':       '<path d="M12 2s5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 1.5 0 1.5-2 1-4-.5-2 0-4 0-4.5Z"/>',
    'eraser':      '<path d="M20 20H8.5L3 14.5a2 2 0 0 1 0-3l8-8a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3L12.5 20"/><line x1="8" y1="8" x2="16" y2="16"/>',
    'refresh':     '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><polyline points="21 3 21 9 15 9"/>',
    'hourglass':   '<path d="M6 2h12"/><path d="M6 22h12"/><path d="M6 2v4a6 6 0 0 0 6 6 6 6 0 0 0-6 6v4"/><path d="M18 2v4a6 6 0 0 1-6 6 6 6 0 0 1 6 6v4"/>',

    /* feedback */
    'check':       '<polyline points="4 12 9 17 20 6"/>',
    'check-circle':'<circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/>',
    'x':           '<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>',
    'alert':       '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    'zap':         '<polygon points="13 2 4 14 12 14 11 22 20 10 12 10 13 2"/>',
    'star':        '<polygon points="12 2 15.1 8.6 22 9.6 17 14.5 18.2 21.5 12 18.2 5.8 21.5 7 14.5 2 9.6 8.9 8.6 12 2"/>',
    'circle':      '<circle cx="12" cy="12" r="9"/>',
    'plus':        '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    'inbox':       '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z"/>',
    'bell':        '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',

    /* arrows — RTL note: "forward" in this UI points left */
    'arrow-left':  '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    'external':    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    'menu':        '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>'
  };

  function svg(name) {
    var d = P[name];
    if (!d) return '';
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + d + '</svg>';
  }

  /* Fill every <span data-icon> inside root that has not been rendered yet. */
  function render(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-icon]:not([data-icon-done])');
    for (var i = 0; i < nodes.length; i++) {
      var el   = nodes[i];
      var name = el.getAttribute('data-icon');
      var markup = svg(name);
      if (!markup) {
        // Unknown name: leave the node empty rather than showing a broken glyph,
        // and say so once in the console so it gets fixed.
        console.warn('[lg-icons] unknown icon:', name);
        continue;
      }
      el.innerHTML = markup;
      el.setAttribute('data-icon-done', '');
    }
  }

  /* Much of this app renders HTML from JS after load, so watch for new nodes. */
  function observe() {
    if (!global.MutationObserver) return;
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes.length) { render(document); return; }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function init() {
    render(document);
    observe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.lgIcons = { render: render, svg: svg, names: Object.keys(P) };

})(window);
