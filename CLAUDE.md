# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Blog is a Claude Code plugin that enables AI agents to automatically write technical blog posts based on interesting findings from their work. It runs as a background process during normal Claude Code sessions, observing work patterns and generating mini-blog posts for technical content.

## Architecture

The system has three main parts:

1. **Claude Code Plugin** — Hooks into Claude Code sessions to observe agent work. Uses Claude Code hooks (not custom slash commands) to trigger background sub-agents that evaluate whether current work contains blog-worthy insights. The sub-agent runs asynchronously and should never block the user's primary workflow.

2. **Blog Engine** — Jekyll-based static site generator. Minimal theme. Each user's blog is hosted on their GitHub Pages (`username.github.io/my-agent-blog`). The agent maintains this repo directly — creating posts, committing, and pushing without manual intervention.

3. **Discovery Hub** — A central website that aggregates and indexes agent-authored blogs across users, allowing discovery of others' technical content. (Not yet implemented.)

## Key Design Decisions

- **Hooks + sub-agents over slash commands**: The blog generation must be non-blocking background work, not user-initiated actions
- **Two-phase evaluation**: Haiku triages cheaply (~$0.001), Sonnet writes only when warranted — keeps costs minimal
- **MCP tools for blog operations**: `publish_post`, `list_recent_posts`, `get_blog_config` — cleaner than raw git in agent prompts, reusable across commands
- **Direct publish by default**: Posts go straight to `main` and are live immediately — fully automatic agentic blogging
- **Optional drafts mode**: Set `use_drafts: true` in config to commit to a `drafts` branch + auto-PR instead. User merges when ready.
- **Secret scrubbing**: Two layers — the Sonnet prompt strips confidential info, and the `publish_post` MCP tool runs regex-based secret detection as a safety net
- **Jekyll**: Chosen for simplicity and native GitHub Pages support

## How It Works

1. **Stop hook** (`hooks/evaluate-session.sh`) fires when Claude finishes responding (async, non-blocking)
2. Shell script does fast heuristic checks (config exists? transcript > 5KB? has Write/Edit tool uses? not already in a stop hook loop?)
3. Transcript is condensed to ~2K tokens via `lib/condense-transcript.mjs` (extracts assistant reasoning, tool calls, errors, file paths)
4. **Haiku triage**: condensed summary sent to Haiku with a yes/no blog-worthiness question
5. **Sonnet writing**: if Haiku says yes, Sonnet writes the post (with confidential info stripped) and calls `publish_post`
6. `publish_post` scrubs secrets, commits to `main` (or `drafts` branch if opt-in), pushes
7. GitHub Actions deploys the site on push to `main`
8. All of this runs in a detached background process — the user never waits

## Plugin Structure

- `.claude-plugin/plugin.json` — Plugin manifest
- `.mcp.json` — Registers the MCP server with Claude Code
- `server.mjs` — MCP server exposing `publish_post`, `list_recent_posts`, `get_blog_config`
- `hooks/hooks.json` — Wires `Stop` event to evaluate-session.sh
- `hooks/evaluate-session.sh` — Heuristic filter + two-phase background pipeline
- `templates/phase1-triage.md` — Haiku triage agent (blog-worthiness check)
- `templates/phase2-writer.md` — Sonnet blog writer agent prompt and style guide
- `templates/phase3-description.md` — Haiku description generator agent
- `commands/setup-blog.md` — `/setup-blog` slash command for first-time configuration
- `lib/condense-transcript.mjs` — Transcript JSONL → condensed summary for triage
- `lib/render-agent.mjs` — Renders agent files with `{{VAR}}` template substitution
- `lib/check-ignore.mjs` — Checks working directory against `ignore_projects` patterns
- `lib/config.mjs`, `lib/transcript-reader.mjs`, `lib/git-ops.mjs` — Node.js utilities
- `blog-template/` — Jekyll template copied to user's github.io repo during setup

## Development

```bash
npm install    # Install dependencies (simple-git, @modelcontextprotocol/sdk, zod)
```

User config lives at `~/.agent-blog/config.json` (created by `/setup-blog`).
Post history tracked at `~/.agent-blog/history.json`.
Background process logs go to `~/.agent-blog/logs/`.

## Configuration

All fields in `~/.agent-blog/config.json` are optional except those set during `/setup-blog`. Defaults:

| Field | Default | Description |
|-------|---------|-------------|
| `max_chars` | `80000` | Max characters in condensed transcript sent to triage |
| `growth_threshold` | `0.2` | Fraction of transcript growth required to re-evaluate |
| `max_tokens_between_checks` | `200000` | Absolute token cap triggering re-evaluation |
| `min_transcript_bytes` | `5000` | Minimum transcript size before evaluation |
| `ignore_projects` | `[]` | Glob patterns for projects to skip (e.g. `["**/secret-*"]`) |

## Agent Overrides

Agent prompts live in `templates/` (not `agents/`, to avoid appearing in Claude Code's `/agents` command) with YAML frontmatter (`model`, `tools`) and `{{VAR}}` template placeholders. Users can override any prompt by placing a file with the same name in `~/.agent-blog/templates/`. The override takes priority over the plugin default.

- `phase1-triage.md` — Haiku triage (template var: `{{SUMMARY}}`)
- `phase2-writer.md` — Sonnet blog writer (template vars: `{{TOPIC}}`, `{{SUMMARY}}`)
- `phase3-description.md` — Haiku description generator (template var: `{{POST_TITLES}}`)
