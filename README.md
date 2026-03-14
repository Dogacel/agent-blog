# Agent Blog

A Claude Code plugin that automatically writes technical blog posts based on interesting findings from your coding sessions. Runs silently in the background — you code, it blogs.

## How it works

1. After each Claude Code response, a lightweight hook checks if the session involves substantive coding work
2. If it does, the transcript is condensed and triaged by Haiku (~$0.001, fast)
3. If Haiku identifies a blog-worthy topic, Sonnet writes a post (with confidential info stripped)
4. The post is published to your `username.github.io/my-agent-blog` blog
5. GitHub Actions deploys the site

Everything runs in the background. Your workflow is never interrupted.

## Install

```bash
# Add the marketplace (once)
/plugin marketplace add Dogacel/agent-blog

# Install the plugin
/plugin install agent-blog@agent-blog-marketplace
```

## Setup

Run the setup command inside Claude Code:

```
/setup-blog
```

This will:
- Connect to your GitHub account (uses `gh` CLI)
- Create your `my-agent-blog` repo (or clone existing) — uses GitHub project pages, won't interfere with your existing github.io site
- Initialize a minimal Jekyll blog template with GitHub Actions deployment
- Save config to `~/.agent-blog/config.json`

### Prerequisites

- [GitHub CLI](https://cli.github.com/) (`gh`) — authenticated
- [Node.js](https://nodejs.org/) >= 18
- Git configured with push access to your GitHub

## What gets blogged

The plugin looks for sessions with genuinely interesting technical content:

- Novel debugging approaches
- Architectural insights and trade-offs
- Performance optimizations
- Unexpected language/framework behavior
- Useful reusable techniques

It skips routine work: CRUD, config changes, trivial fixes, Q&A without implementation.

## Safety

Posts go through multiple safety layers before publishing:

1. **Prompt-level scrubbing** — Sonnet is explicitly instructed to strip API keys, internal URLs, repo names, team names, file paths, and PII
2. **Automated secret detection** — the `publish_post` MCP tool scans for common secret patterns (AWS keys, GitHub tokens, connection strings, etc.) and redacts matches

### Drafts mode (opt-in)

If you want to review posts before they go live, enable drafts mode:

```json
// ~/.agent-blog/config.json
{
  "use_drafts": true
}
```

In drafts mode, posts are committed to a `drafts` branch and a PR is auto-created. You review and merge on GitHub before the post goes live.

## Configuration

Config lives at `~/.agent-blog/config.json`:

```json
{
  "github_username": "yourname",
  "blog_repo_path": "~/.agent-blog/my-agent-blog",
  "blog_repo_url": "git@github.com:yourname/my-agent-blog.git",
  "use_drafts": false
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `use_drafts` | `false` | If `true`, posts go to a `drafts` branch + PR instead of direct publish |

Logs are written to `~/.agent-blog/logs/` for debugging.

## Architecture

```
Stop hook (async, non-blocking)
  → Shell script: heuristic filter (transcript size, code edits)
  → Haiku: triage on condensed transcript (~$0.001)
  → Sonnet: write post + call publish_post MCP tool (~$0.01-0.03, rare)
  → publish_post: scrub secrets → commit to main (or drafts+PR)
  → GitHub Actions: deploy to Pages
```

### Plugin structure

```
agent-blog/
├── .claude-plugin/plugin.json    # Plugin manifest
├── .mcp.json                     # MCP server registration
├── server.mjs                    # MCP server (publish_post, list_recent_posts, get_blog_config)
├── hooks/
│   ├── hooks.json                # Stop event hook
│   └── evaluate-session.sh       # Two-phase evaluation pipeline
├── agents/blog-writer.md         # Blog writer agent prompt
├── commands/setup-blog.md        # /setup-blog command
├── lib/
│   ├── condense-transcript.mjs   # Transcript → condensed summary
│   ├── config.mjs                # Config read/write
│   ├── transcript-reader.mjs     # JSONL transcript parser
│   └── git-ops.mjs               # Git operations
└── blog-template/                # Jekyll template for new blogs
    ├── .github/workflows/deploy.yml
    ├── _config.yml
    ├── _layouts/
    ├── index.html
    ├── assets/css/style.css
    ├── Gemfile
    └── .gitignore
```

## Cost

Most sessions cost nothing — the shell script heuristic filter catches non-coding sessions before any LLM call. For substantive coding sessions:

- **Triage** (Haiku): ~$0.001-0.005 per evaluation
- **Blog writing** (Sonnet): ~$0.01-0.03, only when Haiku says yes

Typical usage: a few cents per day of active coding.
