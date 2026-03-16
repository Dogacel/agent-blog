#!/bin/bash
set -euo pipefail

# Test harness for evaluate-session.sh — runs all 3 phases in foreground.
# Skips nohup/debounce/lock. Sets CLAUDE_PLUGIN_ROOT for MCP tools.
#
# Usage: bash hooks/test-evaluate.sh <transcript-path>
# Env:   SKIP_PHASE2=1  — skip the Sonnet writer (saves cost)
#        SKIP_PHASE3=1  — skip the description update

TRANSCRIPT_PATH="${1:?Usage: $0 <transcript-path>}"
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$HOME/.agent-blog/config.json"
LOG_DIR="$HOME/.agent-blog/logs"
LOG_ID="test-$(date +%s)"

# Set CLAUDE_PLUGIN_ROOT so MCP config resolves correctly
export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"

# Unset ANTHROPIC_API_KEY to use keychain OAuth (API key overrides it)
unset ANTHROPIC_API_KEY 2>/dev/null || true

mkdir -p "$LOG_DIR"

[ -f "$CONFIG_FILE" ] || { echo "FAIL: config not found at $CONFIG_FILE — run /setup-blog first"; exit 1; }
[ -f "$TRANSCRIPT_PATH" ] || { echo "FAIL: transcript not found: $TRANSCRIPT_PATH"; exit 1; }

echo "Plugin root: $PLUGIN_ROOT"
echo "Transcript:  $TRANSCRIPT_PATH ($(stat -f%z "$TRANSCRIPT_PATH" 2>/dev/null || stat -c%s "$TRANSCRIPT_PATH") bytes)"
echo "Log:         $LOG_DIR/$LOG_ID.log"
echo ""

# --- Phase 1: Condense ---
echo "=== Phase 1a: Condensing transcript ==="
SUMMARY=$(node "$PLUGIN_ROOT/lib/condense-transcript.mjs" "$TRANSCRIPT_PATH" 2>/dev/null)
if [ -z "$SUMMARY" ]; then
  echo "FAIL: condense returned empty"
  exit 1
fi
echo "OK (${#SUMMARY} chars)"
echo ""

# --- Phase 1: Triage ---
echo "=== Phase 1b: Haiku triage ==="
AGENT_JSON=$(SUMMARY="$SUMMARY" node "$PLUGIN_ROOT/lib/render-agent.mjs" "$PLUGIN_ROOT" phase1-triage 2>/dev/null)
if [ -z "$AGENT_JSON" ]; then
  echo "FAIL: render-agent returned empty for phase1-triage"
  exit 1
fi
echo "Model: $(printf '%s' "$AGENT_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("model","?"))')"

echo "Calling claude..."
TRIAGE=$(claude --agents "{\"triage\": $AGENT_JSON}" --agent triage \
  --print --no-session-persistence \
  -p "Reply with exactly one line: YES <topic> or NO <reason>" 2>&1)
echo "Triage result: $TRIAGE"

echo "$TRIAGE" | grep -qi "^YES" || { echo "Triage said NO — stopping."; exit 0; }

TOPIC=$(echo "$TRIAGE" | sed "s/^YES[[:space:]]*//")
echo "Topic: $TOPIC"
echo ""

# --- Phase 2: Write ---
if [ "${SKIP_PHASE2:-}" = "1" ]; then
  echo "=== Phase 2: SKIPPED (SKIP_PHASE2=1) ==="
else
  echo "=== Phase 2: Sonnet writer ==="
  AGENT_JSON=$(TOPIC="$TOPIC" SUMMARY="$SUMMARY" node "$PLUGIN_ROOT/lib/render-agent.mjs" "$PLUGIN_ROOT" phase2-writer 2>/dev/null)
  if [ -z "$AGENT_JSON" ]; then
    echo "FAIL: render-agent returned empty for phase2-writer"
    exit 1
  fi
  echo "Model: $(printf '%s' "$AGENT_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("model","?"))')"
  echo "Tools: $(printf '%s' "$AGENT_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("tools","?"))')"

  echo "Calling claude (this may take a while)..."
  claude --agents "{\"writer\": $AGENT_JSON}" --agent writer \
    --print --no-session-persistence \
    --mcp-config "$PLUGIN_ROOT/.mcp.json" \
    --allowedTools "mcp__agent-blog__publish_post,mcp__agent-blog__list_recent_posts,mcp__agent-blog__get_blog_config" \
    -p "Write and publish a blog post about the topic described in your instructions. Follow the workflow and guidelines exactly." \
    2>&1 | tee -a "$LOG_DIR/$LOG_ID.log"
  echo ""
fi

# --- Phase 3: Update description ---
if [ "${SKIP_PHASE3:-}" = "1" ]; then
  echo "=== Phase 3: SKIPPED (SKIP_PHASE3=1) ==="
else
  echo "=== Phase 3: Update blog description ==="
  BLOG_REPO=$(jq -r '.blog_repo_path // empty' "$CONFIG_FILE")
  if [ -z "$BLOG_REPO" ] || [ ! -d "$BLOG_REPO/_posts" ]; then
    echo "SKIP: no blog repo or _posts dir found"
  else
    POST_TITLES=$(grep -rh "^title:" "$BLOG_REPO/_posts/"*.md 2>/dev/null | sed 's/^title: *//' | sed 's/^"//;s/"$//' | head -30)
    echo "Post titles:"
    echo "$POST_TITLES"
    echo ""

    if [ -z "$POST_TITLES" ]; then
      echo "SKIP: no post titles found"
    else
      AGENT_JSON=$(POST_TITLES="$POST_TITLES" node "$PLUGIN_ROOT/lib/render-agent.mjs" "$PLUGIN_ROOT" phase3-description 2>/dev/null)
      if [ -z "$AGENT_JSON" ]; then
        echo "FAIL: render-agent returned empty for phase3-description"
        exit 1
      fi
      echo "Model: $(printf '%s' "$AGENT_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("model","?"))')"

      echo "Calling claude for description..."
      DESCRIPTION=$(claude --agents "{\"desc\": $AGENT_JSON}" --agent desc \
        --print --no-session-persistence \
        -p "Reply with only the description sentence, nothing else. No quotes, no period." 2>&1)
      echo "Description: $DESCRIPTION"

      if [ -n "$DESCRIPTION" ]; then
        echo "Calling update_blog_description MCP tool..."
        claude --print --no-session-persistence \
          --mcp-config "$PLUGIN_ROOT/.mcp.json" \
          --allowedTools "mcp__agent-blog__update_blog_description" \
          -p "Call update_blog_description with this description: $DESCRIPTION" \
          2>&1 | tee -a "$LOG_DIR/$LOG_ID.log"
      fi
    fi
  fi
fi

echo ""
echo "=== All phases complete ==="
echo "Log: $LOG_DIR/$LOG_ID.log"
