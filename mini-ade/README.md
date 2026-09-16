# mini-ADE

A personal, stripped-down deployment of CloudCLI: one launchd service on a Mac,
reachable from a phone over Tailscale, with a small set of patches applied on top
of the published `@cloudcli-ai/cloudcli` package.

It does **not** build from this repo's source. `package.json` pins the npm
release, and `patches/apply.sh` edits the installed `dist/` and `dist-server/`
files in place. The fork exists so the patches can be diffed against upstream.

## Layout

| Path | What it is |
| --- | --- |
| `run.sh` | launchd entry point: env, paths, `cli.js start` |
| `package.json` / `package-lock.json` | pins the CloudCLI release |
| `patches/apply.sh` | every patch, idempotent, safe to re-run |
| `patches/mini-ade.js` | injected UI script (chrome trimming, restart button) |
| `patches/mini-ade-debug.js` | opt-in scroll diagnostic (`#miniade-debug`) |
| `patches/mini-ade.routes.js` | server routes mounted at `/api/mini-ade` |

## Install

```sh
npm install
zsh patches/apply.sh
```

Then point a launchd agent at `run.sh`. Re-run `apply.sh` after every CloudCLI
upgrade — each patch verifies its anchor and fails loudly if upstream moved.

## The patches

| # | Change |
| --- | --- |
| 1 | Only index provider sessions from folders added through the UI |
| 2 | Trim UI chrome (GitHub star pill, community/issue links, mode selector) |
| 4 | Coerce object-shaped auth errors to text (they blanked the app, React #31) |
| 5 | Hide headless runs (`claude -p`, SDK scripts) from the sidebar |
| 6 | "Restart server" button + `/api/mini-ade` status/restart routes |
| 7 | Restore scroll position relative to the live position after loading older messages |
| 8 | Drop `content-visibility` from chat messages — it made mobile Safari scrolling springy |
| 9 | Sidebar tweaks: no path subtext, independent project expansion, New session moved and recoloured, stronger selected-session highlight |
| 10 | Content-hash renames patched assets so the service worker cannot serve stale copies |

Numbering has gaps because a patch that stopped being needed was removed rather
than renumbered.

## Notes

- Paths in `apply.sh` are absolute (`$HOME/Developer/mini-ADE`).
- Patch 10 must run last: it renames assets after every other edit.
- `data/`, `logs/` and local credentials are deliberately not in this repo.
