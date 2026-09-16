// mini-ADE scroll diagnostic. Loaded by mini-ade.js only when localStorage
// 'miniAdeDebug' is set (open the app with #miniade-debug; #miniade-debug-off clears).
// Records who moves the chat scroll position, then hands you the log to paste.
(function () {
  var MAX = 120;
  var log = [];
  var t0 = Date.now();
  function at() { return ((Date.now() - t0) / 1000).toFixed(2); }
  function isChat(el) {
    return !!(el && el.querySelector && el.querySelector('[data-message-timestamp]'));
  }
  function pos(el) {
    return Math.round(el.scrollTop) + '/' + Math.round(el.scrollHeight - el.clientHeight);
  }
  // Which call site moved it: minified frames give line:col into the bundle,
  // which maps straight back to the source.
  function where() {
    var lines = (new Error().stack || '').split('\n').slice(2, 6);
    return lines.map(function (l) {
      var m = l.match(/(index-[^/)]*\.js):(\d+):(\d+)/);
      return m ? m[1].slice(0, 12) + ':' + m[2] + ':' + m[3] : l.trim().slice(0, 60);
    }).join(' < ');
  }
  function push(kind, el, detail) {
    log.push(at() + 's ' + kind + ' ' + pos(el) + ' ' + detail);
    if (log.length > MAX) { log.shift(); }
    render();
  }
  var desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get: function () { return desc.get.call(this); },
    set: function (value) {
      if (isChat(this)) {
        var from = Math.round(desc.get.call(this));
        push('SET', this, '-> ' + Math.round(value) + ' (d' + (Math.round(value) - from) + ') ' + where());
      }
      desc.set.call(this, value);
    },
  });
  var scrollTo = Element.prototype.scrollTo;
  Element.prototype.scrollTo = function (opts) {
    if (isChat(this)) { push('SCROLLTO', this, JSON.stringify(opts) + ' ' + where()); }
    return scrollTo.apply(this, arguments);
  };
  var intoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    var host = this.closest && this.closest('*');
    while (host && !isChat(host)) { host = host.parentElement; }
    if (host) { push('INTOVIEW', host, where()); }
    return intoView.apply(this, arguments);
  };
  var lastScroll = 0;
  document.addEventListener('scroll', function (e) {
    var el = e.target;
    if (el && el.nodeType === 1 && isChat(el) && Date.now() - lastScroll > 120) {
      lastScroll = Date.now();
      push('scroll', el, '');
    }
  }, { capture: true, passive: true });

  var panel, body;
  function render() {
    if (!panel) { return; }
    body.textContent = log.slice(-4).join('\n');
  }
  function build() {
    if (panel || !document.body) { return; }
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:4px 6px;' +
      'background:rgba(0,0,0,.85);color:#0f0;font:10px ui-monospace,monospace;white-space:pre-wrap';
    body = document.createElement('div');
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;margin-top:3px';
    ['Copy', 'Clear', 'Hide'].forEach(function (name) {
      var b = document.createElement('button');
      b.textContent = name;
      b.style.cssText = 'flex:1;padding:4px;background:#222;color:#0f0;border:1px solid #0f0;border-radius:4px';
      b.onclick = function () {
        if (name === 'Clear') { log = []; render(); return; }
        if (name === 'Hide') { panel.remove(); panel = null; return; }
        var text = log.join('\n');
        if (navigator.clipboard) { navigator.clipboard.writeText(text); }
        b.textContent = 'Copied ' + log.length;
        setTimeout(function () { b.textContent = 'Copy'; }, 1500);
      };
      bar.appendChild(b);
    });
    panel.appendChild(body);
    panel.appendChild(bar);
    document.body.appendChild(panel);
  }
  build();
  document.addEventListener('DOMContentLoaded', build);
  setTimeout(build, 1500);
})();
