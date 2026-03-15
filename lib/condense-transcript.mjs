#!/usr/bin/env node

/**
 * Reads a JSONL transcript and outputs a lightly condensed version.
 * Keeps the full narrative — user messages, assistant reasoning, tool
 * calls, and results. Only strips binary content and very long tool
 * results (truncated, not removed).
 *
 * Run manually: node condense-transcript.mjs /path/to/transcript.jsonl
 */

import { readFile } from "node:fs/promises";
import { readConfig } from "./config.mjs";

async function main() {
  const transcriptPath = process.argv[2];
  if (!transcriptPath) {
    console.error("Usage: node condense-transcript.mjs <transcript.jsonl>");
    process.exit(1);
  }

  const config = await readConfig();
  const MAX_CHARS = config?.max_chars ?? 80000; // ~20K tokens — let Haiku see the real session

  const raw = await readFile(transcriptPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());

  const parts = [];

  for (const line of lines) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    const role = msg?.role;
    const content = msg?.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === "text") {
        const text = block.text?.trim();
        if (!text) continue;
        // Truncate very long text blocks but keep most of it
        const truncated = text.length > 2000 ? text.slice(0, 2000) + "\n[...truncated]" : text;
        parts.push(`[${role}] ${truncated}`);
      }

      if (block.type === "tool_use") {
        const name = block.name || "unknown";
        const input = block.input || {};

        if (name === "Edit") {
          const file = input.file_path || "";
          const old_s = input.old_string || "";
          const new_s = input.new_string || "";
          parts.push(`[tool:Edit] ${file}\n  - ${old_s.slice(0, 500)}\n  + ${new_s.slice(0, 500)}`);
        } else if (name === "Write") {
          const file = input.file_path || "";
          const content = input.content || "";
          parts.push(`[tool:Write] ${file}\n${content.slice(0, 1000)}`);
        } else if (name === "Bash") {
          parts.push(`[tool:Bash] ${(input.command || "").slice(0, 500)}`);
        } else if (name === "Read") {
          parts.push(`[tool:Read] ${input.file_path || ""}`);
        } else if (name === "Grep") {
          parts.push(`[tool:Grep] pattern="${input.pattern || ""}" path=${input.path || ""}`);
        } else if (name === "Glob") {
          parts.push(`[tool:Glob] ${input.pattern || ""}`);
        } else {
          // Other tools — include name and truncated input
          parts.push(`[tool:${name}] ${JSON.stringify(input).slice(0, 300)}`);
        }
      }

      if (block.type === "tool_result") {
        const text =
          typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
              ? block.content
                  .filter((c) => c.type === "text")
                  .map((c) => c.text)
                  .join("")
              : "";

        if (!text) continue;
        const prefix = block.is_error ? "[error]" : "[result]";
        const truncated = text.length > 1000 ? text.slice(0, 1000) + "\n[...truncated]" : text;
        parts.push(`${prefix} ${truncated}`);
      }
    }
  }

  // Join and truncate to budget, preferring to keep the beginning and end
  let output = parts.join("\n\n");

  if (output.length > MAX_CHARS) {
    const keepStart = Math.floor(MAX_CHARS * 0.6);
    const keepEnd = MAX_CHARS - keepStart - 50;
    output =
      output.slice(0, keepStart) +
      "\n\n[... middle of session omitted ...]\n\n" +
      output.slice(output.length - keepEnd);
  }

  process.stdout.write(output);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
