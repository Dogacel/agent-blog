#!/usr/bin/env node

/**
 * Renders an agent template with variable substitution.
 *
 * Resolves the template path: user override (~/.agent-blog/templates/<phase>.md)
 * takes priority over plugin default (<pluginRoot>/templates/<phase>.md).
 *
 * Parses YAML frontmatter (model, tools, description) and template body.
 * Template variables ({{VAR}}) are replaced from environment variables.
 *
 * Usage: SUMMARY="..." node render-agent.mjs <plugin-root> <phase-name>
 * Outputs: JSON object compatible with claude --agents flag
 *   {"model": "haiku", "prompt": "...", "tools": [...], "description": "..."}
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function resolveAgentPath(phaseName, pluginRoot) {
  const userPath = join(homedir(), ".agent-blog", "templates", `${phaseName}.md`);
  if (existsSync(userPath)) return userPath;
  const defaultPath = join(pluginRoot, "templates", `${phaseName}.md`);
  if (existsSync(defaultPath)) return defaultPath;
  return null;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter = {};
  let lastKey = null;
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      const [, key, value] = kv;
      lastKey = key;
      if (!value.trim()) {
        // Key with no inline value — expect list items below
        frontmatter[key] = [];
      } else if (value.trim().startsWith("-")) {
        frontmatter[key] = [value.trim().replace(/^-\s*/, "")];
      } else {
        frontmatter[key] = value.trim();
      }
    } else if (line.match(/^\s+-\s+/) && lastKey) {
      // YAML list item — append to last key
      if (!Array.isArray(frontmatter[lastKey])) {
        frontmatter[lastKey] = [];
      }
      frontmatter[lastKey].push(line.trim().replace(/^-\s*/, ""));
    }
  }

  return { frontmatter, body: match[2].trim() };
}

async function main() {
  const pluginRoot = process.argv[2];
  const phaseName = process.argv[3];

  if (!pluginRoot || !phaseName) {
    console.error("Usage: node render-agent.mjs <plugin-root> <phase-name>");
    process.exit(1);
  }

  const agentPath = resolveAgentPath(phaseName, pluginRoot);
  if (!agentPath) {
    console.error(`Agent file not found: ${phaseName}.md`);
    process.exit(1);
  }

  let content = await readFile(agentPath, "utf-8");

  // Replace {{VAR}} placeholders with values from environment variables
  content = content.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    const value = process.env[varName];
    return value !== undefined ? value : match;
  });

  const { frontmatter, body } = parseFrontmatter(content);

  const agent = {
    prompt: body,
  };

  if (frontmatter.model) agent.model = frontmatter.model;
  if (frontmatter.description) agent.description = frontmatter.description;
  if (frontmatter.tools) {
    agent.tools = Array.isArray(frontmatter.tools)
      ? frontmatter.tools
      : [frontmatter.tools];
  }

  process.stdout.write(JSON.stringify(agent));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
