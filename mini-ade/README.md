# mini-ADE

A personal, stripped-down deployment of CloudCLI: one launchd service on a Mac,
reachable from a phone over Tailscale. It runs this fork's own source, built in
place. The mini-ADE changes are ordinary commits on `main`, so `git log` against
upstream is the list of what differs.

It used to run the published `@cloudcli-ai/cloudcli` package with a set of
string-anchored patches applied to its minified build. That setup was retired on
2026-09-28 after every patch had been ported into the source.

## Layout

The checkout lives at `~/Developer/mini-ADE` and doubles as the deployment.

| Path | What it is |
| --- | --- |
| `run.sh` | launchd entry point: env, paths, `cli.js start` |
| `dist/`, `dist-server/` | build output, served as-is (`npm run build`) |
| `data/` | the SQLite DB (`cloudcli.db`) and its backups. Untracked |
| `logs/` | launchd stdout and stderr. Untracked |
| `credentials.txt` | local login. Untracked |
| `public/mini-ade.js` | UI trim script and the sidebar restart button |
| `public/mini-ade-debug.js` | opt-in diagnostic overlay (`#miniade-debug`) |
| `server/modules/mini-ade/` | `/api/mini-ade` status and restart routes |
| `mini-ade/specs/` | design notes for work in progress |
| `mini-ade/tests/` | end-to-end checks against the real CLI |

## Deploy a change

```sh
npm run build
launchctl kickstart -k gui/$(id -u)/com.jason.ade
```

A restart kills every chat in flight, since each one is a child process of the
server. Restart when sessions are idle. `mini-ade/specs/SESSION-SUPERVISOR-SPEC.md`
is the plan to remove that limit. UI-only changes need no restart, just a reload.

Smoke-test server changes on another port against a copy of the DB first:

```sh
cp data/cloudcli.db /tmp/smoke.db
DATABASE_PATH=/tmp/smoke.db SERVER_PORT=3002 ./run.sh
```

## Tests

```sh
npm test                                                  # server
NODE_OPTIONS=--no-experimental-webstorage npm run test:client
```

The client suite needs that flag on Node 26, or jsdom's localStorage is shadowed.
Four server tests in `claude-cli-path.test.ts` fail on macOS because they assume
Windows paths.
