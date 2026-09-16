#!/bin/zsh
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export SERVER_PORT="${SERVER_PORT:-3001}"
export HOST="${ADE_HOST:-127.0.0.1}"  # zsh presets HOST to the machine name; force it
export CLAUDE_CLI_PATH="$HOME/.local/bin/claude"
export DATABASE_PATH="$HOME/Developer/mini-ADE/data/cloudcli.db"
mkdir -p "$HOME/Developer/mini-ADE/data"
cd "$HOME/Developer/mini-ADE"
exec "$HOME/.local/node/bin/node" node_modules/@cloudcli-ai/cloudcli/dist-server/server/modules/cli/cli.js start
