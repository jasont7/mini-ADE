// mini-ADE UI trim. Served from public/ and loaded by index.html.
(function () {
  var GONE = 'data-mini-ade-hidden';
  function hide(el) {
    if (el && !el.hasAttribute(GONE)) { el.setAttribute(GONE, '1'); el.style.display = 'none'; }
  }
  // iOS capitalizes the first letter of the username, which fails the login.
  function fixInputs() {
    document.querySelectorAll('input[type="text"],input[type="password"],input:not([type])').forEach(function (i) {
      if (i.getAttribute('autocapitalize') !== 'none') {
        i.setAttribute('autocapitalize', 'none');
        i.setAttribute('autocorrect', 'off');
        i.setAttribute('spellcheck', 'false');
      }
    });
  }
  function trim() {
    // 1. GitHub "Star" pill at the top of the sidebar.
    //    Hide the link itself when it is not inside the badge. Falling back to
    //    the parent hid the whole collapsed rail, since its Report Issue link
    //    also points at github.com/siteboon, and took Show sidebar with it.
    document.querySelectorAll('a[href^="https://github.com/siteboon"]').forEach(function (a) {
      hide(a.closest('div.group\\/star') || a);
    });
    // 2. Bottom sidebar links: Report Issue, Join Community, any Discord link.
    document.querySelectorAll(
      '[aria-label="Report Issue"],[aria-label="Join Community"],a[href^="https://discord.gg"]'
    ).forEach(hide);
    // 3. Projects / Conversations selector.
    document.querySelectorAll('button[aria-pressed]').forEach(function (b) {
      var t = (b.textContent || '').trim();
      if (t === 'Projects' || t === 'Conversations') { hide(b.parentElement); }
    });
    fixInputs();
    addRestartButtons();
  }
  // 5. "Restart server" next to every sidebar Settings button (rail, desktop, phone).
  var RESTART = 'data-mini-ade-restart';
  var RESTART_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
  function addRestartButtons() {
    var targets = [];
    document.querySelectorAll('button[aria-label="Settings"]').forEach(function (b) {
      var prev = b.previousElementSibling;
      if (prev && prev.classList.contains('nav-divider')) { targets.push(b); }
    });
    document.querySelectorAll('div.md\\:block > button, div.md\\:hidden > button').forEach(function (b) {
      var label = b.querySelector('span:last-child');
      if (label && label.textContent.trim() === 'Settings') { targets.push(b.parentElement); }
    });
    targets.forEach(function (el) {
      var prev = el.previousElementSibling;
      if (prev && prev.hasAttribute(RESTART)) { return; }
      var clone = el.cloneNode(true);
      clone.setAttribute(RESTART, '1');
      var btn = clone.tagName === 'BUTTON' ? clone : clone.querySelector('button');
      btn.setAttribute('aria-label', 'Restart server');
      btn.setAttribute('title', 'Restart server');
      var svg = btn.querySelector('svg');
      if (svg) {
        var holder = document.createElement('span');
        holder.innerHTML = RESTART_ICON;
        var icon = holder.firstChild;
        icon.setAttribute('class', svg.getAttribute('class') || '');
        svg.replaceWith(icon);
      }
      var text = btn.querySelector('span:last-child');
      if (text && text.textContent.trim() === 'Settings') { text.textContent = 'Restart server'; }
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        restartServer();
      });
      // Above Settings, not below: appended after it the button sat flush with
      // the bottom edge of the viewport, where anything fixed to the bottom
      // (or a slightly shorter window) hides it.
      el.before(clone);
    });
  }
  function authHeaders() {
    var token = null;
    try { token = localStorage.getItem('auth-token'); } catch (e) {}
    return token ? { Authorization: 'Bearer ' + token } : {};
  }
  function restartServer() {
    fetch('/api/mini-ade/status', { headers: authHeaders(), cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (status) {
        var n = status ? status.runningSessions : null;
        var who = n === null ? 'All running sessions'
          : n === 1 ? '1 running session' : n + ' running sessions';
        var msg = 'Restart the ADE server?\n\n' + (n === 0
          ? 'No sessions are running right now.'
          : 'WARNING: ' + who + ' will be stopped. Conversations are saved and can be ' +
            'resumed, but any reply in progress will be cut off.');
        if (!window.confirm(msg)) { return; }
        return fetch('/api/mini-ade/restart', { method: 'POST', headers: authHeaders() })
          .then(function (r) {
            if (!r.ok) { throw new Error('HTTP ' + r.status); }
            waitForServer();
          });
      })
      .catch(function (err) { window.alert('Restart failed: ' + err.message); });
  }
  function waitForServer() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(0,0,0,.7);color:#fff;font:15px system-ui,sans-serif';
    overlay.textContent = 'Restarting server…';
    document.body.appendChild(overlay);
    var started = Date.now();
    var wentDown = false;
    (function poll() {
      fetch('/health', { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) { throw new Error(); }
          if (wentDown || Date.now() - started > 8000) { location.reload(); return; }
          setTimeout(poll, 700);
        })
        .catch(function () {
          wentDown = true;
          if (Date.now() - started > 60000) {
            overlay.textContent = 'Server did not come back. Check logs/err.log.';
            return;
          }
          setTimeout(poll, 700);
        });
    })();
  }
  // 4. Phone: a fresh login lands on an empty chat area with nothing selected,
  //    which renders as a black screen. Open the sidebar instead.
  function openSidebarIfEmpty() {
    if (window.innerWidth >= 768) { return; }
    var btn = document.querySelector('[aria-label="Show sidebar"]');
    var hasChat = document.querySelector('textarea, [contenteditable="true"]');
    if (btn && !hasChat) { btn.click(); }
  }
  // 7. Self-heal a stale app shell. An installed PWA can keep serving an old bundle
  //    from the service worker cache, so the phone silently runs different code from
  //    the Mac. Compare the bundle this page loaded against what the server serves
  //    now; on a mismatch, drop the caches, poke the service worker, reload once.
  function healStaleShell() {
    var tag = document.querySelector('script[src*="/assets/index-"]');
    var loaded = tag ? tag.src.split('/').pop() : '';
    if (!loaded) { return; }
    fetch('/index.html', { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var match = html.match(/assets\/(index-[^"]+\.js)/);
        if (!match || match[1] === loaded) { return; }
        // One reload per stale build. If storage is unavailable the guard cannot
        // hold, so do nothing at all rather than risk a reload loop.
        try {
          if (sessionStorage.getItem('miniAdeHealed') === match[1]) { return; }
          sessionStorage.setItem('miniAdeHealed', match[1]);
        } catch (e) { return; }
        var jobs = [];
        if (window.caches) {
          jobs.push(caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) { return caches.delete(k); }));
          }));
        }
        if (navigator.serviceWorker) {
          jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
            return Promise.all(regs.map(function (reg) { return reg.update().catch(function () {}); }));
          }));
        }
        var reload = function () { location.reload(); };
        Promise.all(jobs).then(reload, reload);
      })
      .catch(function () {});
  }
  healStaleShell();

  // Scroll diagnostic, opt-in: open with #miniade-debug (#miniade-debug-off clears).
  function loadDebug() {
    try {
      if (location.hash === '#miniade-debug') { localStorage.setItem('miniAdeDebug', '1'); }
      if (location.hash === '#miniade-debug-off') { localStorage.removeItem('miniAdeDebug'); }
      if (localStorage.getItem('miniAdeDebug') !== '1') { return; }
    } catch (e) { return; }
    var s = document.createElement('script');
    s.src = '/mini-ade-debug.js?' + Date.now();
    document.head.appendChild(s);
  }
  loadDebug();
  try { localStorage.setItem('CLOUDCLI_HIDE_GITHUB_STAR', 'true'); } catch (e) {}
  // Every DOM mutation used to trigger the full sweep below (several
  // document-wide querySelectorAll calls). Rendering one chat message fires
  // hundreds of mutations, so on a phone this dominated load. Coalesce them:
  // at most one sweep per 500ms, and none while the tab is hidden.
  var run = function () { try { trim(); } catch (e) {} };
  var pending = false;
  var scheduleRun = function () {
    if (pending) { return; }
    pending = true;
    setTimeout(function () { pending = false; run(); }, 500);
  };
  // Do not skip while the tab is hidden: a page that loads in a background tab
  // still needs its buttons, and nothing re-triggers the sweep on return.
  document.addEventListener('visibilitychange', scheduleRun);
  run();
  document.addEventListener('DOMContentLoaded', run);
  new MutationObserver(scheduleRun).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(openSidebarIfEmpty, 1200);
  setTimeout(openSidebarIfEmpty, 3000);
})();
