#!/bin/zsh
# launchd entry point for mini-ADE (com.jason.ade). Runs this checkout's own
# build: `npm run build` first. Runtime state lives beside the code, untracked:
# data/ (the SQLite DB) and logs/ (launchd stdout/stderr).
cd "${0:A:h}"
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export SERVER_PORT="${SERVER_PORT:-3001}"
export HOST="${ADE_HOST:-127.0.0.1}"  # zsh presets HOST to the machine name; force it
export CLAUDE_CLI_PATH="$HOME/.local/bin/claude"
export DATABASE_PATH="${DATABASE_PATH:-$PWD/data/cloudcli.db}"
mkdir -p data
exec "$HOME/.local/node/bin/node" dist-server/server/modules/cli/cli.js start
