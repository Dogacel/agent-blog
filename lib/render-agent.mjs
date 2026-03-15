#!/usr/bin/env node

/**
 * Renders an agent file with template variable substitution.
 *
 * Resolves the agent file path: user override (~/.agent-blog/templates/<phase>.md)
 * takes priority over plugin default (<pluginRoot>/templates/<phase>.md).
 *
 * Template variables ({{VAR}}) are replaced from environment variables.
 *
 * Usage: SUMMARY="..." node render-agent.mjs <plugin-root> <phase-name>
 * Outputs: path to rendered temp file
 */

import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

function resolveAgentPath(phaseName, pluginRoot) {
  const userPath = join(homedir(), ".agent-blog", "agents", `${phaseName}.md`);
  if (existsSync(userPath)) return userPath;
  const defaultPath = join(pluginRoot, "agents", `${phaseName}.md`);
  if (existsSync(defaultPath)) return defaultPath;
  return null;
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

  // Write to temp file
  const tmpDir = await mkdtemp(join(tmpdir(), "agent-blog-"));
  const tmpPath = join(tmpDir, `${phaseName}.md`);
  await writeFile(tmpPath, content);

  process.stdout.write(tmpPath);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
