#!/bin/bash
# Auto-install node_modules if missing. Runs on SessionStart.
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$PLUGIN_ROOT" ] || exit 0
[ -d "$PLUGIN_ROOT/node_modules" ] && exit 0

# Install dependencies silently
cd "$PLUGIN_ROOT" && npm install --silent 2>/dev/null
exit 0
