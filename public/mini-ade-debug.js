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

  // --- chat websocket -----------------------------------------------------
  // Session opens (chat.subscribe) and sends (chat.send) travel over /ws, not
  // fetch. This script can load after the app has already opened its socket,
  // so the existing socket is picked up on its first send via the prototype,
  // and later sockets (reconnects) through the constructor.
  var sid8 = function (v) { return typeof v === 'string' ? v.slice(0, 8) : '-'; };
  var watched = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  function watch(ws, how) {
    if (!watched || watched.has(ws) || !/\/ws(\?|$)/.test(ws.url || '')) { return; }
    watched.add(ws);
    push('ws ' + how + ' state=' + ws.readyState);
    ws.addEventListener('open', function () { push('ws OPEN'); });
    ws.addEventListener('close', function (e) { push('ws CLOSE code=' + e.code); });
    ws.addEventListener('message', function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      var k = m && m.kind;
      if (k === 'chat_subscribed') {
        push('ws <- chat_subscribed ' + sid8(m.sessionId) + ' processing=' + m.isProcessing);
      } else if (k === 'complete' || k === 'run_resumed' || k === 'protocol_error') {
        push('ws <- ' + k + ' ' + sid8(m.sessionId) + (m.code ? ' ' + m.code : ''));
      }
    });
  }
  var OrigWS = window.WebSocket;
  if (OrigWS) {
    var origSend = OrigWS.prototype.send;
    OrigWS.prototype.send = function (data) {
      watch(this, 'seen');
      try {
        var m = JSON.parse(data);
        var ids = m.sessionId || (m.sessions && m.sessions.map(function (s) { return sid8(s.sessionId); }).join(','));
        push('ws -> ' + m.type + ' ' + sid8(ids) + ' state=' + this.readyState);
      } catch (e) {}
      return origSend.apply(this, arguments);
    };
    var WrappedWS = function (url, protocols) {
      var ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
      watch(ws, 'NEW');
      return ws;
    };
    WrappedWS.prototype = OrigWS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { WrappedWS[k] = OrigWS[k]; });
    window.WebSocket = WrappedWS;
  }
  // The app's sendMessage drops a message silently apart from this warning.
  var origWarn = console.warn;
  console.warn = function () {
    if (String(arguments[0]).indexOf('WebSocket') !== -1) { push('WARN ' + String(arguments[0]).slice(0, 80)); }
    return origWarn.apply(console, arguments);
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
