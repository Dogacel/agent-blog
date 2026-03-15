#!/usr/bin/env node

/**
 * Checks if a working directory matches any ignore_projects patterns.
 *
 * Usage: node check-ignore.mjs <working-directory>
 * Exit code 0 = allowed (not ignored), 1 = ignored
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function globToRegex(pattern) {
  // Expand leading ~ to home directory
  if (pattern.startsWith("~/")) {
    pattern = join(homedir(), pattern.slice(2));
  } else if (pattern === "~") {
    pattern = homedir();
  }

  // Escape regex special chars except * and ?
  let regex = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");

  // Convert glob patterns to regex
  // ** matches any number of path segments
  regex = regex.replace(/\*\*/g, "\0GLOBSTAR\0");
  // * matches anything except /
  regex = regex.replace(/\*/g, "[^/]*");
  // ? matches any single char except /
  regex = regex.replace(/\?/g, "[^/]");
  // Restore globstar
  regex = regex.replace(/\0GLOBSTAR\0/g, ".*");

  return new RegExp(`^${regex}$`);
}

async function main() {
  const workingDir = process.argv[2];
  if (!workingDir) {
    console.error("Usage: node check-ignore.mjs <working-directory>");
    process.exit(1);
  }

  const configPath = join(homedir(), ".agent-blog", "config.json");
  if (!existsSync(configPath)) {
    // No config = not ignored
    process.exit(0);
  }

  const config = JSON.parse(await readFile(configPath, "utf-8"));
  const patterns = config.ignore_projects;

  if (!Array.isArray(patterns) || patterns.length === 0) {
    process.exit(0);
  }

  for (const pattern of patterns) {
    const regex = globToRegex(pattern);
    if (regex.test(workingDir)) {
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
