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

# Heuristic: skip short sessions (< 5KB transcript)
TSIZE=$(stat -f%z "$TRANSCRIPT_PATH" 2>/dev/null || stat -c%s "$TRANSCRIPT_PATH" 2>/dev/null || echo "0")
[ "$TSIZE" -gt 5000 ] || exit 0

# Heuristic: must have code edits
grep -q '"Write"\|"Edit"' "$TRANSCRIPT_PATH" 2>/dev/null || exit 0

mkdir -p "$LOG_DIR"
LOG_ID="${SESSION_ID:-$(date +%s)}"

# Debounce: skip if transcript hasn't grown significantly since last eval.
# Store last evaluated size per session. Require at least 20% growth to re-evaluate.
DEBOUNCE_FILE="$LOG_DIR/.debounce_${LOG_ID}"
LAST_SIZE=0
[ -f "$DEBOUNCE_FILE" ] && LAST_SIZE=$(cat "$DEBOUNCE_FILE")
GROWTH_THRESHOLD=$(( LAST_SIZE + LAST_SIZE / 5 ))  # 20% growth minimum
if [ "$TSIZE" -le "$GROWTH_THRESHOLD" ] && [ "$LAST_SIZE" -gt 0 ]; then
  exit 0
fi
echo "$TSIZE" > "$DEBOUNCE_FILE"

# Lock: prevent concurrent evaluations of the same session
LOCK_FILE="$LOG_DIR/.lock_${LOG_ID}"
if ! mkdir "$LOCK_FILE" 2>/dev/null; then
  # Another evaluation is already running for this session
  exit 0
fi

# --- Two-phase evaluation ---
# Phase 1: Condense transcript and triage with Haiku (cheap + fast)
# Phase 2: If blog-worthy, write with Sonnet using MCP tools

# Run both phases in background so the hook returns immediately
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

# Phase 1: Haiku triage
TRIAGE=$(claude --print --no-session-persistence --model haiku -p "You are a blog triage agent. Given this session summary, decide if it contains genuinely interesting technical content worth a short blog post.

Blog-worthy: novel debugging, architectural insights, performance wins, unexpected behavior, useful reusable techniques.
NOT blog-worthy: routine CRUD, config changes, trivial fixes, purely project-specific work, Q&A without implementation.

Session summary:
$SUMMARY

Reply with exactly one line: YES <topic> or NO <reason>" 2>/dev/null)

echo "[$(date)] Triage result: $TRIAGE" >> "$LOG_DIR/$LOG_ID.log"

# Check if Haiku said YES
echo "$TRIAGE" | grep -qi "^YES" || exit 0

TOPIC=$(echo "$TRIAGE" | sed "s/^YES[[:space:]]*//" )

# Phase 2: Sonnet writes the blog post using MCP tools
claude --print --no-session-persistence --model sonnet \
  --mcp-config "$PLUGIN_ROOT/.mcp.json" \
  --allowedTools "mcp__agent-blog__publish_post,mcp__agent-blog__list_recent_posts,mcp__agent-blog__get_blog_config" \
  -p "You are a technical blog writer. Write a concise, high-quality blog post about this topic from a coding session and publish it.

Topic: $TOPIC

Session details:
$SUMMARY

Instructions:
1. First call list_recent_posts to check for duplicate topics. If a similar post exists, stop.
2. Write a post (300-800 words): start with the problem, then the investigation, the solution with code snippets, and a one-line takeaway. Use first person plural (\"we\"). Be specific and technical.
3. SAFETY: You MUST strip ALL of the following from your post:
   - API keys, tokens, passwords, secrets, credentials
   - Internal URLs, IP addresses, hostnames
   - Repository names, organization names, team names
   - File paths that reveal user identity or project structure
   - Any personally identifiable information
   Replace specific names with generic equivalents (e.g. \"our API\" instead of \"Acme Corp API\").
4. Call publish_post with: a short actionable title, the markdown content, a category (debugging|architecture|performance|til|tooling|integration), and 2-4 technical tags." \
  >> "$LOG_DIR/$LOG_ID.log" 2>&1

' -- "$PLUGIN_ROOT" "$TRANSCRIPT_PATH" "$LOG_ID" "$LOG_DIR" > /dev/null 2>&1 &

exit 0
