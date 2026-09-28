# Spec: stop mini-ADE running one conversation in several CLI processes

Written 2026-09-16 from a read of the installed `@cloudcli-ai/cloudcli` server
code. Everything below is a pointer into
`node_modules/@cloudcli-ai/cloudcli/dist-server/server/`, which is compiled but
readable. Line numbers are from the version installed today — re-anchor on the
quoted text, not the numbers.

## What goes wrong

One conversation ends up with two or more live `claude` processes at once. Each
has the full tool set, none knows about the others, and the transcript they
share is whichever one wrote last. Two of them took opposite sides of the same
pull request today: both believed they owned it, one pushed a merge the other
was still resolving, and a third was told to take over by a fourth.

Observed directly:

```
$ ps -eo pid,etime,command | grep '[c]laude --output-format stream-json'
12023  25:11  .../claude ... --resume=2a68c4f5-b0b7-4104-a98f-4a6712205d58 ...
44846  00:42  .../claude ... --resume=2a68c4f5-b0b7-4104-a98f-4a6712205d58 ...
```

Same `--resume` id, two processes, 25 minutes apart. The sidebar showed the
conversation under a different generated name after each resume.

## Why it happens

There are two independent process paths and three separate registries, none of
which is keyed by anything stable:

| Path | Spawns | Registry | Key |
|---|---|---|---|
| Chat | `@anthropic-ai/claude-agent-sdk` `query()` | `activeSessions` (runtime), `runs` (gateway) | app session id, else provider id |
| Terminal tab | `pty.spawn('bash', ['-c', 'claude --resume <id>'])` | `ptySessionsMap` | `` `${projectPath}_${sessionId}` `` |

No registry stores a pid, and nothing correlates the two paths.

### Cause 1 — the watcher files one conversation twice

`modules/providers/list/claude/claude-session-synchronizer.provider.js`,
`processSessionFile` (~L88):

```js
const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
    ?? sessionsDb.getSessionById(parsed.sessionId);
```

A transcript whose id is not yet mapped becomes a brand-new row
(`synchronizeFile` L65 → `sessions.db.js` `createSession` L86 INSERT), with a
fresh display name. The app row created for the same conversation is still
waiting for the runtime to report its provider id, which only happens later at
`chat-run-registry.service.js` L88 `sessionsDb.assignProviderSessionId(...)`.

Between those two moments there are **two rows for one conversation**. Either
can be opened, sent to, or resumed in a terminal, and each lands in a different
registry key. That is the "same conversation, new session name" symptom, and it
is the cause worth fixing first.

The fix already exists in this codebase, for the other provider.
`modules/providers/list/opencode/opencode-session-synchronizer.provider.js`
L83-91 claims the pending app row before the watcher can insert:

```js
const pendingAppSession = sessionsDb.getSessionByProviderSessionId(sessionId)
    ?? sessionsDb.getSessionById(sessionId)
    ?? sessionsDb.findLatestPendingAppSession(this.provider, projectPath);
if (pendingAppSession && !pendingAppSession.provider_session_id) {
    sessionsDb.assignProviderSessionId(pendingAppSession.session_id, sessionId);
}
```

`findLatestPendingAppSession` (`sessions.db.js` L347) is written for exactly
this race — its own doc comment describes the duplicate sidebar entry — and is
called from the OpenCode synchronizer only. The Claude synchronizer never calls
it.

### Cause 2 — a finished turn keeps its process for up to 30 minutes

`modules/websocket/services/chat-run-registry.service.js` L59-66 flips
`run.status = 'completed'` as soon as the terminal `complete` event passes
through. The process behind it is still alive: the runtime holds stdin open so
background work can keep reporting.

`modules/providers/list/claude/claude-runtime.provider.js`:

- L52 `const BG_WAIT_CEILING_MS = 30 * 60 * 1000;`
- L522-533 `createHeldPromptStream` — `await held;` keeps stdin open until `release()`
- L636-647 `scheduleRelease()`, re-armed on every message (L881-884), so it
  measures silence rather than total elapsed time
- L869-878 — only turns that start background work are held (`Bash` with
  `run_in_background`, `Monitor`, `ScheduleWakeup`, `CronCreate`, `TaskCreate`)

So the gateway believes the session is idle while its process lives on. The only
guard against stacking is `claude-runtime.provider.js` L630-634:

```js
if (sessionKey()) {
    getSession(sessionKey())?.releaseInput?.();
}
```

`sessionKey()` (L606) is `sessionId || capturedSessionId || null` — the app id
when one was passed, the provider id otherwise. Two keys for one conversation
(Cause 1, or a REST caller that passes no session id) never cancel each other.
`addSession`'s supersede check (L250-278) compares the same single key.

Callers that register under the provider id and bypass the gateway entirely:

- `modules/agent/agent.routes.js` L882 — `queryClaudeSDK(..., { sessionId: sessionId || null })`
- `modules/git/git.routes.js` L906 — `queryClaudeSDK(prompt, { cwd: projectPath })`, no session id

### Cause 3 — nothing reconciles live processes with the app

- Server shutdown: `index.js` L315-337 `shutdownRuntimeServices` stops
  browser-use, plugins and the local-server marker, then `process.exit(0)`. It
  never iterates `activeSessions`, `runs` or `ptySessionsMap`.
- Server boot: the maps start empty. Any surviving `claude` is invisible to the
  app forever, but still attached to the transcript.
- Row deletion: `session-synchronizer.service.js` L26-47 `pruneOrphanedSessions`
  and `project-delete.service.js` L38-73 delete rows without consulting either
  process map or aborting anything.
- Terminal tabs: `shell-websocket.service.js` L8 `PTY_SESSION_TIMEOUT = 30 min`,
  fired on ws close (L438-450). Closing a terminal tab leaves
  `claude --resume` running for a full half hour.

## The work

Three patches, in this order. Each is small; the first alone removes most of the
damage. Follow the conventions in `patches/apply.sh`: a `mini-ADE patch` marker
for idempotency, an anchor-count assertion that fails loudly when upstream moves
the code, and a line in the file header saying it must be re-run after any
upgrade of `@cloudcli-ai/cloudcli`.

### Patch A — claim the pending app row before the watcher inserts (do this first)

File: `modules/providers/list/claude/claude-session-synchronizer.provider.js`,
in `processSessionFile`.

Mirror the OpenCode synchronizer: add
`?? sessionsDb.findLatestPendingAppSession(this.provider, parsed.projectPath)`
to the `existingSession` lookup, and when the row it finds has no
`provider_session_id`, call
`sessionsDb.assignProviderSessionId(row.session_id, parsed.sessionId)` before
returning.

Keep mini-ADE patch 5 (the `!nameMap.has(...)` headless-run skip) working: the
pending-row lookup must run **before** that check, or an interactive resume that
has not reached `history.jsonl` yet will still be dropped.

Result: one row per conversation, one sidebar name, one registry key.

Verify: with the app running, start a conversation, send one message, wait for
the 6-second watcher poll, then

```sql
SELECT provider_session_id, COUNT(*) FROM sessions
WHERE provider_session_id IS NOT NULL
GROUP BY provider_session_id HAVING COUNT(*) > 1;
```

against `data/cloudcli.db` — expect no rows. Repeat with the machine under load
(that is what opens the race).

### Patch B — supersede by conversation, not by key string

File: `modules/providers/list/claude/claude-runtime.provider.js`.

Make the pre-turn release at L630-634 and the supersede check in `addSession`
(L250-278) match on the **provider session id** as well as the map key. The
runtime already knows it: `capturedSessionId`, and `sdkOptions.resume` is set
from `providerSessionId` at L231-232. Simplest shape that holds: keep a second
index from provider session id to the same session entry, and release through
both before spawning.

While here, store the child pid on the `activeSessions` entry (the SDK exposes
it) so a future reaper has something to kill. Entries currently hold only
`{ instance, startTime, status, writer, releaseInput }`.

Result: a second turn on a conversation closes the first process instead of
running beside it, however the caller addressed the session.

Verify: send a message that starts background work (any `run_in_background`
Bash), then send a second message before 30 minutes are up.
`ps -eo pid,etime,command | grep '[c]laude --output-format stream-json'` should
show exactly one process for that `--resume` id.

### Patch C — reconcile on shutdown and on boot

File: `modules/index.js` (`shutdownRuntimeServices`, L315-337).

On shutdown, walk `activeSessions` and `ptySessionsMap` and stop each child
before `process.exit(0)`. On boot, kill any `claude` process left parented to a
dead server — `patches/mini-ade.routes.js` L11-16 already finds them with
`pgrep -P <serverpid> claude`; the same query with the previous pid (persist it
next to the local-server marker) gives the orphan list.

Result: restarting the CLI stops leaving a live copy of the last conversation
behind.

Optional, same patch: drop `PTY_SESSION_TIMEOUT` in
`modules/websocket/services/shell-websocket.service.js` L8 from 30 minutes to
something like 2, so a closed terminal tab stops holding a CLI open.

## Out of scope, worth knowing

- The 30-minute hold itself is deliberate — it is what lets background work
  report after a turn ends. Do not remove it; make the overlap impossible
  instead.
- The agent that consumes this spec should not be the only copy of itself
  running. Check `ps` for duplicate `--resume` ids before starting, and again
  after restarting the server to load the patches.
