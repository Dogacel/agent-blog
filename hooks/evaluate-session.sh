#!/bin/bash
set -euo pipefail

# Read hook input from stdin
HOOK_INPUT=$(cat)

# Prevent infinite loops — bail if already in a stop hook continuation
STOP_HOOK_ACTIVE=$(echo "$HOOK_INPUT" | jq -r '.stop_hook_active // false')
[ "$STOP_HOOK_ACTIVE" = "false" ] || exit 0

TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // empty')
SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // empty')
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"

CONFIG_FILE="$HOME/.agent-blog/config.json"
LOG_DIR="$HOME/.agent-blog/logs"

# Exit silently if not configured
[ -f "$CONFIG_FILE" ] || exit 0

# Exit if no transcript or plugin root
[ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ] || exit 0
[ -n "$PLUGIN_ROOT" ] || exit 0

# Read configurable thresholds from config (with defaults)
GROWTH_THRESHOLD_PCT=$(jq -r '.growth_threshold // 0.2' "$CONFIG_FILE")
MAX_TOKENS=$(jq -r '.max_tokens_between_checks // 200000' "$CONFIG_FILE")
MIN_TRANSCRIPT=$(jq -r '.min_transcript_bytes // 5000' "$CONFIG_FILE")

# Check if this project is ignored
node "$PLUGIN_ROOT/lib/check-ignore.mjs" "$PWD" || exit 0

# Heuristic: skip short sessions
TSIZE=$(stat -f%z "$TRANSCRIPT_PATH" 2>/dev/null || stat -c%s "$TRANSCRIPT_PATH" 2>/dev/null || echo "0")
[ "$TSIZE" -gt "$MIN_TRANSCRIPT" ] || exit 0

# Heuristic: must have code edits
grep -q '"Write"\|"Edit"' "$TRANSCRIPT_PATH" 2>/dev/null || exit 0

mkdir -p "$LOG_DIR"
LOG_ID="${SESSION_ID:-$(date +%s)}"

# Debounce: skip if transcript hasn't grown significantly since last eval.
DEBOUNCE_FILE="$LOG_DIR/.debounce_${LOG_ID}"
LAST_SIZE=0
[ -f "$DEBOUNCE_FILE" ] && LAST_SIZE=$(cat "$DEBOUNCE_FILE")
# Reset debounce if transcript shrank (compaction happened)
if [ "$TSIZE" -lt "$LAST_SIZE" ]; then
  LAST_SIZE=0
fi
# Trigger if EITHER: transcript grew by growth_threshold %, OR absolute growth exceeds max_tokens * 4 bytes
GROWTH_NEEDED=$(awk "BEGIN {printf \"%d\", $LAST_SIZE * $GROWTH_THRESHOLD_PCT}")
GROWTH_MIN=$(( LAST_SIZE + GROWTH_NEEDED ))
ABS_CAP_BYTES=$(( MAX_TOKENS * 4 ))
GROWTH_SINCE=$(( TSIZE - LAST_SIZE ))
if [ "$TSIZE" -le "$GROWTH_MIN" ] && [ "$GROWTH_SINCE" -lt "$ABS_CAP_BYTES" ] && [ "$LAST_SIZE" -gt 0 ]; then
  exit 0
fi
echo "$TSIZE" > "$DEBOUNCE_FILE"

# Lock: prevent concurrent evaluations of the same session
LOCK_FILE="$LOG_DIR/.lock_${LOG_ID}"
if ! mkdir "$LOCK_FILE" 2>/dev/null; then
  # Another evaluation is already running for this session
  exit 0
fi

# --- Three-phase evaluation ---
# Phase 1: Condense transcript and triage with Haiku (cheap + fast)
# Phase 2: If blog-worthy, write with Sonnet using MCP tools
# Phase 3: Update blog description

# Run all phases in background so the hook returns immediately
nohup bash -c '
PLUGIN_ROOT="$1"
TRANSCRIPT_PATH="$2"
LOG_ID="$3"
LOG_DIR="$4"
LOCK_FILE="$LOG_DIR/.lock_${LOG_ID}"

# Clean up lock on exit
trap "rmdir \"$LOCK_FILE\" 2>/dev/null" EXIT

# Phase 1: Condense transcript
SUMMARY=$(node "$PLUGIN_ROOT/lib/condense-transcript.mjs" "$TRANSCRIPT_PATH" 2>/dev/null)
[ -n "$SUMMARY" ] || exit 0

echo "[$(date)] === Condensed transcript ===" >> "$LOG_DIR/$LOG_ID.log"
echo "$SUMMARY" >> "$LOG_DIR/$LOG_ID.log"
echo "[$(date)] === End condensed transcript ===" >> "$LOG_DIR/$LOG_ID.log"

# Phase 1: Haiku triage via agent file
AGENT_FILE=$(SUMMARY="$SUMMARY" node "$PLUGIN_ROOT/lib/render-agent.mjs" "$PLUGIN_ROOT" phase1-triage 2>/dev/null)
[ -n "$AGENT_FILE" ] || exit 0
TRIAGE=$(claude --agent "$AGENT_FILE" --print --no-session-persistence -p "Reply with exactly one line: YES <topic> or NO <reason>" 2>/dev/null)
rm -f "$AGENT_FILE"
rmdir "$(dirname "$AGENT_FILE")" 2>/dev/null

echo "[$(date)] Triage result: $TRIAGE" >> "$LOG_DIR/$LOG_ID.log"

# Check if Haiku said YES
echo "$TRIAGE" | grep -qi "^YES" || exit 0

TOPIC=$(echo "$TRIAGE" | sed "s/^YES[[:space:]]*//" )

# Phase 2: Sonnet writes the blog post via agent file
AGENT_FILE=$(TOPIC="$TOPIC" SUMMARY="$SUMMARY" node "$PLUGIN_ROOT/lib/render-agent.mjs" "$PLUGIN_ROOT" phase2-writer 2>/dev/null)
[ -n "$AGENT_FILE" ] || exit 0
claude --agent "$AGENT_FILE" --print --no-session-persistence \
  --mcp-config "$PLUGIN_ROOT/.mcp.json" \
  -p "Write and publish a blog post about the topic described in your instructions. Follow the workflow and guidelines exactly." \
  >> "$LOG_DIR/$LOG_ID.log" 2>&1
rm -f "$AGENT_FILE"
rmdir "$(dirname "$AGENT_FILE")" 2>/dev/null

# Phase 3: Update blog description via MCP tool
BLOG_REPO=$(jq -r ".blog_repo_path // empty" "$HOME/.agent-blog/config.json")
if [ -n "$BLOG_REPO" ] && [ -d "$BLOG_REPO/_posts" ]; then
  # Collect all post titles
  POST_TITLES=$(grep -rh "^title:" "$BLOG_REPO/_posts/"*.md 2>/dev/null | sed "s/^title: *//" | sed "s/^\"//;s/\"$//" | head -30)

  if [ -n "$POST_TITLES" ]; then
    AGENT_FILE=$(POST_TITLES="$POST_TITLES" node "$PLUGIN_ROOT/lib/render-agent.mjs" "$PLUGIN_ROOT" phase3-description 2>/dev/null)
    if [ -n "$AGENT_FILE" ]; then
      DESCRIPTION=$(claude --agent "$AGENT_FILE" --print --no-session-persistence -p "Reply with only the description sentence, nothing else. No quotes, no period." 2>/dev/null)
      rm -f "$AGENT_FILE"
      rmdir "$(dirname "$AGENT_FILE")" 2>/dev/null

      if [ -n "$DESCRIPTION" ]; then
        # Use MCP tool to write, commit, and push
        claude --print --no-session-persistence \
          --mcp-config "$PLUGIN_ROOT/.mcp.json" \
          --allowedTools "mcp__agent-blog__update_blog_description" \
          -p "Call update_blog_description with this description: $DESCRIPTION" \
          >> "$LOG_DIR/$LOG_ID.log" 2>&1
      fi
    fi
  fi
fi

' -- "$PLUGIN_ROOT" "$TRANSCRIPT_PATH" "$LOG_ID" "$LOG_DIR" >> "$LOG_DIR/$LOG_ID.log" 2>&1 &

exit 0
