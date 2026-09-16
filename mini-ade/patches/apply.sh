#!/bin/zsh
# mini-ADE patches. Re-run after any upgrade of @cloudcli-ai/cloudcli.
# 1) Only index provider sessions whose folder was explicitly added in the UI.
node - "$HOME/Developer/mini-ADE/node_modules/@cloudcli-ai/cloudcli/dist-server/server/modules/database/repositories/sessions.db.js" <<'EOF'
const fs=require('fs');const f=process.argv[2];let s=fs.readFileSync(f,'utf8');
const marker='mini-ADE patch';
if(s.includes(marker)){console.log('patch 1: already applied');process.exit(0)}
const old="        projectsDb.createProjectPath(normalizedProjectPath);\n        const existing = db\n";
const hits=s.split(old).length-1;
if(hits!==1){console.error('patch 1 FAILED: anchor found '+hits+' times');process.exit(1)}
const neu=`        // ${marker}: skip sessions from folders not added through the UI.
        if (!projectsDb.getProjectPath(normalizedProjectPath)) {
            const knownRow = db
                .prepare('SELECT session_id FROM sessions WHERE provider_session_id = ? AND provider = ? LIMIT 1')
                .get(providerSessionId, provider);
            return knownRow ? knownRow.session_id : null;
        }
`+old;
fs.writeFileSync(f,s.replace(old,neu));console.log('patch 1: applied');
EOF

# 2) Trim UI chrome (GitHub star pill, community/issue links, mode selector).
APP="$HOME/Developer/mini-ADE/node_modules/@cloudcli-ai/cloudcli/dist"
cp "$HOME/Developer/mini-ADE/patches/mini-ade.js" "$APP/mini-ade.js"
cp "$HOME/Developer/mini-ADE/patches/mini-ade-debug.js" "$APP/mini-ade-debug.js"
if grep -q "mini-ade.js" "$APP/index.html"; then
  echo "patch 2: already applied"
else
  perl -0pi -e 's#</body>#  <script src="/mini-ade.js"></script>\n  </body>#' "$APP/index.html"
  grep -q "mini-ade.js" "$APP/index.html" && echo "patch 2: applied" || { echo "patch 2 FAILED"; exit 1; }
fi

# 4) Upstream bug: auth errors are objects ({code,message}); rendering one blanks
#    the whole app (React #31). Coerce to text, and bust the service-worker cache.
python3 - "$APP" <<'EOF'
import pathlib, re, sys
# Resolve the bundle through index.html: patch 7 renames it to a content hash.
root = pathlib.Path(sys.argv[1])
f = root / 'assets' / re.search(r'assets/(index-[^"]+\.js)', (root / 'index.html').read_text()).group(1)
s = f.read_text()
done = []
old_u4 = 'function U4(e,t){return e?e.error??e.message??t:t}'
new_u4 = ('function U4(e,t){const _v=e?e.error??e.message??t:t;'
          'return _v&&typeof _v==="object"?(_v.message||_v.code||t):_v}')
if new_u4 in s: done.append('U4 already')
elif old_u4 in s: s = s.replace(old_u4, new_u4); done.append('U4 patched')
else: print('patch 4 FAILED: U4 anchor missing'); sys.exit(1)
old_x = 'xN=async(e,t)=>{try{return(await e.json()).error||t}catch{return t}}'
new_x = ('xN=async(e,t)=>{try{const _e=(await e.json()).error;'
         'return(_e&&typeof _e==="object"?(_e.message||_e.code):_e)||t}catch{return t}}')
if new_x in s or 'miniAdeErrText' in s: done.append('xN already')
elif old_x in s: s = s.replace(old_x, new_x); done.append('xN patched')
else: print('patch 4 FAILED: xN anchor missing'); sys.exit(1)
f.write_text(s)
sw = root / 'sw.js'
t = sw.read_text()
if "claude-ui-v2" in t:
    sw.write_text(t.replace("claude-ui-v2", "claude-ui-mini-ade-1"))
    done.append('sw cache busted')
print('patch 4:', ', '.join(done))
EOF

# 5) Hide headless Claude runs (`claude -p`, SDK scripts) from the sidebar.
#    Interactive CLI sessions are logged to ~/.claude/history.jsonl; headless ones
#    are not. App-created sessions are already in the DB, so they still resolve.
node - "$HOME/Developer/mini-ADE/node_modules/@cloudcli-ai/cloudcli/dist-server/server/modules/providers/list/claude/claude-session-synchronizer.provider.js" <<'EOF2'
const fs=require('fs');const f=process.argv[2];let s=fs.readFileSync(f,'utf8');
const marker='mini-ADE patch 5';
if(s.includes(marker)){console.log('patch 5: already applied');process.exit(0)}
const old="        const existingSessionName = existingSession?.custom_name;\n";
const hits=s.split(old).length-1;
if(hits!==1){console.error('patch 5 FAILED: anchor found '+hits+' times');process.exit(1)}
const neu=`        // ${marker}: skip headless runs (never written to history.jsonl).
        if (!existingSession && !nameMap.has(parsed.sessionId)) {
            return null;
        }
`+old;
fs.writeFileSync(f,s.replace(old,neu));console.log('patch 5: applied');
EOF2

# 6) "Restart server" button: server route (/api/mini-ade) + UI in mini-ade.js (patch 2).
SRV="$HOME/Developer/mini-ADE/node_modules/@cloudcli-ai/cloudcli/dist-server/server"
cp "$HOME/Developer/mini-ADE/patches/mini-ade.routes.js" "$SRV/mini-ade.routes.js"
node - "$SRV/index.js" <<'EOF2'
const fs=require('fs');const f=process.argv[2];let s=fs.readFileSync(f,'utf8');
if(s.includes('mini-ade.routes.js')){console.log('patch 6: already applied');process.exit(0)}
const imp="import { voiceRoutes } from './modules/voice/index.js';\n";
const use="app.use('/api/voice', authenticateToken, voiceRoutes);\n";
for(const a of [imp,use]){const h=s.split(a).length-1;if(h!==1){console.error('patch 6 FAILED: anchor found '+h+' times: '+a.trim());process.exit(1)}}
s=s.replace(imp,imp+"import miniAdeRoutes from './mini-ade.routes.js';\n");
s=s.replace(use,use+"app.use('/api/mini-ade', authenticateToken, miniAdeRoutes);\n");
fs.writeFileSync(f,s);console.log('patch 6: applied');
EOF2

# 7) Mobile Safari dragged you back down while scrolling up through history.
#    The chat renders the last 100 messages and loads 20 more when you near the top.
#    Before loading it snapshots your scroll position, then restores that ABSOLUTE
#    position once the batch renders — discarding everything you scrolled during the
#    fetch, which yanks you back down. You are then near the top again, so it loads
#    again: a jump every second or two. (Chrome's native scroll anchoring hides the
#    related shift; Safari has none.) Two fixes:
#      a. compensate for the added height RELATIVE to where you are now;
#      b. re-run the restore when the rendered window grows, not just the message
#         count — a batch already in the store only grows the window.
python3 - "$APP" <<'EOF'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
html = root / 'index.html'
name = re.search(r'assets/(index-[^"]+\.js)', html.read_text()).group(1)
f = root / 'assets' / name
s = f.read_text()
edits = [
    ('restore relative to the live position',
     'if(Ce.current){const{height:it,top:Xe,anchor:Ut,anchorOffset:It}=Ce.current;'
     'if(Ut?.isConnected&&It!==null){const Vr=Ut.getBoundingClientRect().top-'
     'Ke.getBoundingClientRect().top;Ke.scrollTop+=Vr-It}'
     'else Ke.scrollTop=Xe+Math.max(Ke.scrollHeight-it,0);Ce.current=null;return}',
     'if(Ce.current){const _miniAdeBase=z.current?.height??Ce.current.height,'
     '_miniAdeGrow=Ke.scrollHeight-_miniAdeBase;'
     'if(_miniAdeGrow>0)Ke.scrollTop=Ke.scrollTop+_miniAdeGrow;Ce.current=null;return}'),
    ('restore also runs when the rendered window grows',
     '},[He.length,e,C])', '},[He.length,D,e,C])'),
]
for label, old, new in edits:
    if new in s:
        print('patch 7: already applied (%s)' % label)
        continue
    hits = s.count(old)
    if hits != 1:
        print('patch 7 FAILED: anchor found %d times (%s)' % (hits, label))
        sys.exit(1)
    s = s.replace(old, new)
    print('patch 7: applied (%s)' % label)
f.write_text(s)
EOF

# 8) The mobile-Safari "spring": .chat-message uses content-visibility:auto with a
#    96-240px contain-intrinsic-size, so every off-screen message collapses to a
#    placeholder. A 100-message window is then only ~2400px tall and its height
#    thrashes as messages enter/leave view, so two swipes up hit the top of the
#    window, trigger a load, and the restore throws you back down — a spring every
#    second or two. Chrome hides it with native scroll anchoring; Safari has none.
#    Render real heights instead; the window is capped at 100 messages anyway.
python3 - "$APP" <<'EOF'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
html = root / 'index.html'
name = re.search(r'assets/(index-[^"]+\.css)', html.read_text()).group(1)
f = root / 'assets' / name
s = f.read_text()
old = '.chat-message{contain:layout style paint;content-visibility:auto;contain-intrinsic-size:auto 180px}'
new = '.chat-message{contain:layout style paint}'
if new in s:
    print('patch 8: already applied')
else:
    hits = s.count(old)
    if hits != 1:
        print('patch 8 FAILED: anchor found %d times' % hits)
        sys.exit(1)
    s = s.replace(old, new)
    # The per-kind intrinsic sizes only matter with content-visibility; drop them.
    s = re.sub(r'contain-intrinsic-size:auto [0-9]+px!?i?m?p?o?r?t?a?n?t?;?', '', s)
    f.write_text(s)
    print('patch 8: applied (chat messages render at real height)')
EOF

# 9) Drop the subtext under each project name (session count + truncated path).
python3 - "$APP" <<'EOF'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
name = re.search(r'assets/(index-[^"]+\.js)', (root / 'index.html').read_text()).group(1)
f = root / 'assets' / name
s = f.read_text()
old = ('o.jsxs("div",{className:"text-xs text-muted-foreground",children:[W,'
       'e.fullPath!==e.displayName&&o.jsxs("span",{className:"ml-1 opacity-60",title:e.fullPath,'
       'children:[" - ",e.fullPath.length>25?`...${e.fullPath.slice(-22)}`:e.fullPath]})]})')
new = 'null'
if 'children:[W,e.fullPath!==e.displayName' not in s:
    print('patch 9: already applied')
else:
    hits = s.count(old)
    if hits != 1:
        print('patch 9 FAILED: anchor found %d times' % hits)
        sys.exit(1)
    f.write_text(s.replace(old, new))
    print('patch 9: applied (project subtext removed)')
EOF

# 9b) Let several projects stay expanded: the toggle built a fresh empty Set each
#     time, so opening one project collapsed every other (accordion).
python3 - "$APP" <<'EOF'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
name = re.search(r'assets/(index-[^"]+\.js)', (root / 'index.html').read_text()).group(1)
f = root / 'assets' / name
s = f.read_text()
old = 'const Le=f.useCallback(Se=>{y(Me=>{const Oe=new Set;return Me.has(Se)||Oe.add(Se),Oe})},[])'
new = ('const Le=f.useCallback(Se=>{y(Me=>{const Oe=new Set(Me);'
       'return Oe.has(Se)?Oe.delete(Se):Oe.add(Se),Oe})},[])')
if new in s:
    print('patch 9b: already applied')
else:
    hits = s.count(old)
    if hits != 1:
        print('patch 9b FAILED: anchor found %d times' % hits)
        sys.exit(1)
    f.write_text(s.replace(old, new))
    print('patch 9b: applied (projects expand independently)')
EOF

# 9c) Move the "New session" button below the session list (it was the first child
#     of the list container, above every session).
python3 - "$APP" <<'EOF'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
name = re.search(r'assets/(index-[^"]+\.js)', (root / 'index.html').read_text()).group(1)
f = root / 'assets' / name
s = f.read_text()
HEAD = 'className:"ml-3 space-y-1 border-l border-border pl-3",children:['
DELIM = ',a?A?o.jsxs(o.Fragment,{children:[r.map('
TAIL = ':o.jsx(e$e,{})]})}'
if s.count(HEAD) != 1:
    print('patch 9c FAILED: container anchor found %d times' % s.count(HEAD))
    sys.exit(1)
start = s.index(HEAD) + len(HEAD)
if s[start:start + 4] == 'a?A?':
    print('patch 9c: already applied')
    sys.exit(0)
cut = s.index(DELIM, start)
end = s.index(TAIL, cut)
button = s[start:cut]                       # the New session button
sessions = s[cut + 1:end + len(TAIL) - 4]   # list / empty state / skeleton
f.write_text(s[:start] + sessions + ',' + button + s[end + len(TAIL) - 4:])
print('patch 9c: applied (New session button moved below the list)')
EOF

# 9d) Lighter blue for the "New session" button (bg-primary is blue-600; use the
#     already-bundled blue-200 utility so no new CSS is needed).
python3 - "$APP" <<'EOF'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
name = re.search(r'assets/(index-[^"]+\.js)', (root / 'index.html').read_text()).group(1)
f = root / 'assets' / name
s = f.read_text()
edits = [
    ('rounded-md bg-primary text-xs font-medium text-primary-foreground '
     'transition-all duration-150 hover:bg-primary/90',
     'rounded-md bg-blue-200 text-xs font-medium text-blue-900 '
     'transition-all duration-150 hover:bg-blue-100'),
    ('justify-start gap-2 bg-primary text-xs font-medium text-primary-foreground '
     'transition-colors hover:bg-primary/90',
     'justify-start gap-2 bg-blue-200 text-xs font-medium text-blue-900 '
     'transition-colors hover:bg-blue-100'),
]
done = 0
for old, new in edits:
    if new in s:
        continue
    hits = s.count(old)
    if hits != 1:
        print('patch 9d FAILED: anchor found %d times' % hits)
        sys.exit(1)
    s = s.replace(old, new)
    done += 1
if done:
    f.write_text(s)
    print('patch 9d: applied (New session button -> blue-200)')
else:
    print('patch 9d: already applied')
EOF

# 9e) Make the selected session stand out: it was bg-primary/5 with a /20 border,
#     nearly invisible next to unselected rows.
python3 - "$APP" <<'EOF'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
name = re.search(r'assets/(index-[^"]+\.js)', (root / 'index.html').read_text()).group(1)
f = root / 'assets' / name
s = f.read_text()
edits = [
    ('w?"bg-primary/5 border-primary/20":""', 'w?"bg-primary/20 border-primary/50":""'),
    ('w?"border-primary/20 bg-primary/5":"border-border/30"',
     'w?"border-primary/50 bg-primary/20":"border-border/30"'),
]
done = 0
for old, new in edits:
    if new in s:
        continue
    hits = s.count(old)
    if hits != 1:
        print('patch 9e FAILED: anchor found %d times' % hits)
        sys.exit(1)
    s = s.replace(old, new)
    done += 1
if done:
    f.write_text(s)
    print('patch 9e: applied (selected session darker)')
else:
    print('patch 9e: already applied')
EOF

# 10) Cache-bust LAST, after every edit above: the service worker caches /assets/
#     cache-first by filename, so an in-place edit keeps serving phones the old copy.
#     Name each asset after its contents and point index.html + the SW cache at it.
python3 - "$APP" <<'EOF'
import hashlib, pathlib, re, sys
root = pathlib.Path(sys.argv[1])
html = root / 'index.html'
digests = []
for ext in ('js', 'css'):
    text = html.read_text()
    name = re.search(r'assets/(index-[^"]+\.%s)' % ext, text).group(1)
    f = root / 'assets' / name
    digest = hashlib.sha256(f.read_bytes()).hexdigest()[:8]
    digests.append(digest)
    target = f.with_name('index-%s.mini.%s' % (digest, ext))
    if f.name == target.name:
        continue
    f.rename(target)
    html.write_text(text.replace(name, target.name))
    for stale in (root / 'assets').glob('index-*.mini.%s' % ext):
        if stale != target:
            stale.unlink()
    print('cache-bust: %s -> %s' % (name, target.name))
sw = root / 'sw.js'
sw.write_text(re.sub(r"CACHE_NAME = '[^']*'",
                     "CACHE_NAME = 'claude-ui-mini-ade-%s'" % '-'.join(digests), sw.read_text()))
EOF
