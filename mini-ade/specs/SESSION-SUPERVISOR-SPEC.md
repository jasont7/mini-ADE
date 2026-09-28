# Spec: chat sessions that survive a server restart

Written 2026-09-28. Code pointers are relative to the repo root (`~/Developer/mini-ADE`).
Re-anchor on the quoted names, not line numbers.

## The problem

Every server change needs `launchctl kickstart -k gui/$(id -u)/com.jason.ade`, and
that restart kills every live chat. Transcripts survive and a session resumes on
the next message, but anything the CLI process was holding dies with it:

- a turn in flight is cut off mid-reply
- background work goes: Monitors, `run_in_background` shells, background agents,
  ScheduleWakeup / CronCreate timers
- pending permission prompts are lost

So each restart turns into "wait until every chat is idle". Sessions that sit
on a long Monitor are never idle. The example that prompted this: a BioResearch
session with a Monitor polling Narval over ssh for Slurm jobs, 28 minutes in.

## Why a restart kills the session

Two separate causes. Fixing only one is not enough.

1. **launchd kills the job's process group.** The SDK spawns each `claude` CLI
   as a plain child of the server, so it inherits the server's process group.
   Observed: server PID 56696, CLI 4449, both with PGID 56696. When a launchd
   job dies, launchd kills whatever is left in its process group, because the
   plist (`~/Library/LaunchAgents/com.jason.ade.plist`) does not set
   `AbandonProcessGroup`.
2. **The server owns the only pipes to the CLI.** The Agent SDK talks to the CLI
   over stdin/stdout (stream-json). When the server exits, stdin hits EOF (the
   CLI reads that as "wind down") and stdout has no reader. A new server process
   cannot take over another process's pipes. It can only spawn a fresh
   `claude --resume`, which starts from the transcript with no background work.

Plus a third thing to rebuild: all run state lives in server memory.
`chatRunRegistry` (seq numbers, replay buffer, running/completed),
`activeSessions` and `pendingToolApprovals` in `claude-runtime.provider.js`, and
the per-run locals in `queryClaudeSDK` (`turnCompleteSent`, `autonomousTurn`,
`heldForBackgroundWork`, the held prompt stream, the idle-release timer).

## Goal

Restarting the server (to deploy new code) leaves every CLI process running. The
new server reattaches to each one, clients see the stream continue, and
background work carries on. A reattached session must be indistinguishable from
one that never restarted, apart from a short gap in the live stream that replay
fills.

Non-goals: surviving a machine reboot or a CLI crash. Those still fall back to
`--resume` from the transcript, as today.

## Design: one supervisor process per live CLI

A small, standalone Node script (the "session host") owns each CLI process. The
server talks to the host over a unix socket instead of to the CLI directly.

```
server  <--unix socket-->  session host  <--stdin/stdout pipes-->  claude CLI
(restarts freely)          (detached, own session)                 (never sees the restart)
```

### The session host

- Spawned by the server with `detached: true` (so `setsid`: new session, new
  process group, outside launchd's cleanup) and `unref()`ed. Survives the
  server dying.
- Spawns the CLI itself with the exact `command`, `args`, `cwd`, `env` the SDK
  asked for, and holds its stdin open. The server dying never EOFs the CLI.
- Appends every stdout line (stream-json) to a log file with a byte offset or
  line number: `data/hosts/<appSessionId>.log`. This is the replay source after
  a reconnect.
- Listens on `data/hosts/<appSessionId>.sock` (keep the path short, since
  macOS caps unix socket paths at 104 bytes).
- Protocol, newline-delimited JSON:
  - `attach { fromLine }`: replay log lines after `fromLine`, then stream live
  - `stdin { data }`: write to the CLI's stdin
  - `signal { name }`: kill/interrupt the CLI
  - `status`: pid, alive, exit code, last line number
- When the CLI exits, the host records the exit code, keeps the socket up long
  enough for one final attach (or a fixed grace like 5 minutes), then deletes
  its files and exits.
- Must be dumb and stable. Its code must not need to change when the server
  does, because live hosts keep running the old copy. Version the protocol in
  the `status` reply.

### Wiring it into the SDK

The SDK supports this directly. `Options.spawnClaudeCodeProcess(options)` in
`@anthropic-ai/claude-agent-sdk` (0.3.165, `sdk.d.ts` ~line 1981) replaces the
local spawn and must return a `SpawnedProcess`: `stdin`, `stdout`, `killed`,
`exitCode`, `kill(signal)`, `on/once/off('exit' | 'error')`. Return an object
whose streams are the socket to a freshly started host. Set it in
`mapCliOptionsToSDK` next to the existing `sdkOptions.env` line.

Careful with `kill()`: on server shutdown the SDK may try to close or kill the
"process". During a deliberate restart that must be a no-op on the host side.
Distinguish "the user aborted" (forward the signal) from "the server is going
away" (detach only).

### Reattaching after a restart

This is the hard half. On startup the server scans `data/hosts/*.sock`, asks
each for `status`, and for every live CLI:

1. Rebuilds a `chatRunRegistry` run for the app session. Running or completed
   depends on whether the log's last `result` came after the last turn's start.
2. Re-registers it in `activeSessions`, so abort, follow-up delivery
   (`findLiveRun` / `continueWith`) and permission responses find it.
3. Resumes reading output.

**Open question, check this first:** can a new SDK `query()` attach to a CLI
that an earlier `query()` already initialized? `query()` begins with an
`initialize` control request. Unknown whether the CLI accepts a second one
mid-life. Also, callbacks registered by the old SDK instance (hooks, in-process
SDK MCP servers) carry ids the new instance does not know. `canUseTool` should
be fine, since any instance can answer a `can_use_tool` control request.

If reattaching through the SDK does not work, fall back to a thin
reader of our own for reattached sessions: parse stream-json from the host,
run it through the same `transformMessage` / `normalizeMessage` path, and write
user turns and control responses straight to stdin. New sessions keep using the
SDK. Only a restart moves a session onto the thin path.

### Things that must keep working

- One process per conversation (`DUPLICATE-SESSIONS-SPEC.md`,
  `tests/one-process-per-conversation.mjs`). The reattach scan must run before
  the server accepts `chat.send`, or a message arriving early spawns a second
  CLI next to the surviving one.
- Follow-ups delivered to the live process (`continueWith` in
  `claude-runtime.provider.js`, commit 65b5a1d5).
- Self-started turns reopening the run (`run_resumed`, the 2026-09-28 fix in
  `chat-run-registry.service.ts` `resumeRun`). After a reattach, the same
  rule has to hold for turns that started while the server was down.
- The 30 minute idle backstop (`BG_WAIT_CEILING_MS`). Today the server's timer
  releases stdin. Across a restart that timer is lost, so either the host owns
  the backstop or the reattach re-arms it.
- Edits (`resumeAnchorId`) still get their own process.
- Aborting a reattached run.
- Pending permission prompts: an unanswered `can_use_tool` request in the log
  must reappear in the UI after reattach (`chat_subscribed.pendingPermissions`).

### Housekeeping

- Orphans: a host whose server never reattaches (server removed, DB reset) must
  not live forever. It exits once the CLI exits, and the CLI already has the
  idle backstop. Add a sweep on startup for sockets with no matching session row.
- Logs grow for the life of a CLI. Truncate below the oldest offset any client
  could still need, or cap them like `MAX_BUFFERED_EVENTS_PER_RUN`.
- Belt and braces: add `AbandonProcessGroup = true` to the plist. It is not
  needed once hosts use `setsid`, but it stops a missed spawn path from being
  killed. Changing the plist needs a `bootout` / `bootstrap`, which is itself
  a restart, so do it together with the first deploy of this.

## Test plan

1. Unit: the host protocol (attach with replay, stdin, signal, exit handling).
2. End to end against the real CLI, like the 2026-09-28 check. Start a run with a
   background `sleep 60 && echo done`, restart the server mid-sleep, and assert:
   - the CLI pid is unchanged
   - the self-started turn after the sleep reaches a client subscribed to the
     new server, preceded by `run_resumed` and ending with `complete`
   - a follow-up sent after the restart goes to the same process
3. Restart during an in-flight turn: the reply continues, and a client that
   reconnects sees no duplicated or missing rows.
4. Restart with a permission prompt pending: it is still answerable.
5. Abort a reattached run.
6. Run it all on port 3002 against a copy of the DB first, as usual.

## Until this exists

Before a restart, check what is live:

```bash
ps -o pid,pgid,lstart,command -ax | grep '[.]local/bin/claude' | grep -oE '^ *[0-9]+ +[0-9]+ .{24}|--resume=[0-9a-f-]+'
```

For any session with a Monitor or other background work, restart and then tell
that session to re-arm it. Work that runs elsewhere (Slurm jobs on Narval,
remote builds) keeps going. Only the watcher dies.
