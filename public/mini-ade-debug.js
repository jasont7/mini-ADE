// mini-ADE diagnostic. Loaded by mini-ade.js only when localStorage 'miniAdeDebug'
// is set (open the app with #miniade-debug; #miniade-debug-off clears).
//
// Everything is written through to localStorage as it happens, so a log survives
// the app freezing and being force-quit: reopen and the panel shows the previous
// run under "PREV". Tracks phases (route, fetch, render), a heartbeat that makes
// stalls visible as time gaps, errors, and scroll writes.
(function () {
  try {
  var MAX = 150;
  var KEY = 'miniAdeLog';
  var PREV_KEY = 'miniAdeLogPrev';
  var t0 = Date.now();
  var log = [];
  var prev = '';
  try {
    prev = localStorage.getItem(KEY) || '';
    if (prev) { localStorage.setItem(PREV_KEY, prev); }
    localStorage.setItem(KEY, '');
  } catch (e) {}

  function at() { return ((Date.now() - t0) / 1000).toFixed(2) + 's'; }
  // Persisting on every line meant a synchronous storage write per fetch, per
  // scroll, per beat — enough to dominate load on a phone. Flush on a timer
  // instead; a freeze still loses at most one second of log.
  var dirty = false;
  function flush() {
    if (!dirty) { return; }
    dirty = false;
    try { localStorage.setItem(KEY, log.join('\n')); } catch (e) {}
  }
  setInterval(flush, 1000);
  window.addEventListener('pagehide', flush);
  function push(line) {
    log.push(at() + ' ' + line);
    if (log.length > MAX) { log.shift(); }
    dirty = true;
    render();
  }

  // --- errors -------------------------------------------------------------
  window.addEventListener('error', function (e) {
    push('ERROR ' + (e.message || '') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    push('REJECT ' + ((r && (r.message || r.toString())) || 'unknown').slice(0, 120));
  });

  // --- network ------------------------------------------------------------
  // fetch must keep window as its receiver: origFetch.apply(this, ...) throws
  // "Illegal invocation" in Safari whenever the app calls a destructured fetch.
  var origFetch = window.fetch.bind(window);
  window.fetch = function () {
    var args = arguments;
    try {
      var input = args[0];
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!/\/api\/(providers|projects)/.test(url)) { return origFetch.apply(null, args); }
      var started = Date.now();
      // Path only, with the limit spelled out: logging raw query strings gets
      // the line redacted before it reaches a human.
      var u;
      try { u = new URL(url, location.origin); } catch (e) { u = { pathname: url, searchParams: { get: function () { return null; } } }; }
      var lim = u.searchParams.get('limit');
      var short = u.pathname.slice(-60) + ' [limit ' + (lim === null ? 'NONE-full-transcript' : lim) + ']';
      push('fetch -> ' + short);
      return origFetch.apply(null, args).then(function (res) {
        // Only the headers: cloning and reading a 2 MB body doubles memory on a phone.
        push('fetch <- ' + res.status + ' ' + (Date.now() - started) + 'ms ' +
          (res.headers.get('content-length') || '?') + 'B ' + short);
        return res;
      }, function (err) {
        push('fetch FAILED ' + short + ' ' + (err && err.message));
        throw err;
      });
    } catch (e) {
      return origFetch.apply(null, args);
    }
  };

  // --- render heartbeat ---------------------------------------------------
  // A freeze shows up as a gap between consecutive beats.
  var lastBeat = Date.now();
  var lastCount = -1;
  setInterval(function () {
    var now = Date.now();
    var gap = now - lastBeat;
    lastBeat = now;
    var msgs = document.querySelectorAll('[data-message-timestamp]').length;
    if (gap > 2000) { push('STALL ' + gap + 'ms (main thread blocked or backgrounded)'); }
    if (msgs !== lastCount) {
      lastCount = msgs;
      push('render msgs=' + msgs + ' route=' + location.pathname.slice(0, 40));
    }
  }, 1000);

  push('boot ' + location.pathname + ' ua=' + (navigator.userAgent.match(/(iPhone|Macintosh)/) || [''])[0]);

  // --- panel --------------------------------------------------------------
  var panel, body;
  function render() {
    if (body) { body.textContent = log.slice(-4).join('\n'); }
  }
  function build() {
    if (panel || !document.body) { return; }
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:4px 6px;' +
      'background:rgba(0,0,0,.85);color:#0f0;font:10px ui-monospace,monospace;white-space:pre-wrap';
    body = document.createElement('div');
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;margin-top:3px';
    [['Copy', 'this run'], ['Copy PREV', 'the run before the freeze'], ['Hide', '']].forEach(function (pair) {
      var b = document.createElement('button');
      b.textContent = pair[0];
      b.title = pair[1];
      b.style.cssText = 'flex:1;padding:5px;background:#222;color:#0f0;border:1px solid #0f0;border-radius:4px';
      b.onclick = function () {
        if (pair[0] === 'Hide') { panel.remove(); panel = null; return; }
        var text = pair[0] === 'Copy' ? log.join('\n') : (localStorage.getItem(PREV_KEY) || '(no previous run)');
        if (navigator.clipboard) { navigator.clipboard.writeText(text); }
        var was = b.textContent;
        b.textContent = 'Copied';
        setTimeout(function () { b.textContent = was; }, 1200);
      };
      bar.appendChild(b);
    });
    panel.appendChild(body);
    panel.appendChild(bar);
    document.body.appendChild(panel);
    render();
  }
  build();
  document.addEventListener('DOMContentLoaded', build);
  setTimeout(build, 1200);
  } catch (e) {
    // A diagnostic must never break the app it is measuring.
    if (window.console) { console.error('mini-ade-debug disabled:', e); }
  }
})();
