#!/usr/bin/env node

/**
 * Reads a JSONL transcript and outputs a condensed summary suitable for
 * Haiku triage. Extracts: assistant reasoning, tool names + file paths,
 * error patterns, and key code changes. Targets ~2K tokens output.
 */

import { readFile } from "node:fs/promises";

const MAX_CHARS = 8000; // ~2K tokens

async function main() {
  const transcriptPath = process.argv[2];
  if (!transcriptPath) {
    process.exit(1);
  }

  const raw = await readFile(transcriptPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());

  const parts = [];
  const toolStats = new Map();
  const filesEdited = new Set();
  let errorCount = 0;
  let hasRetryPattern = false;
  let lastToolFailed = false;

  for (const line of lines) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    const content = msg?.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === "text" && msg.role === "assistant") {
        // Capture assistant reasoning (truncated)
        const text = block.text?.trim();
        if (text && text.length > 20) {
          parts.push(`[assistant] ${text.slice(0, 300)}`);
        }
      }

      if (block.type === "tool_use") {
        const name = block.name || "unknown";
        toolStats.set(name, (toolStats.get(name) || 0) + 1);

        const input = block.input || {};
        if (input.file_path) filesEdited.add(input.file_path);
        if (input.command) {
          parts.push(`[${name}] ${input.command.slice(0, 150)}`);
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

        // Detect errors
        if (
          block.is_error ||
          /error|fail|exception|traceback/i.test(text.slice(0, 500))
        ) {
          errorCount++;
          if (lastToolFailed) hasRetryPattern = true;
          lastToolFailed = true;
          parts.push(`[error] ${text.slice(0, 200)}`);
        } else {
          lastToolFailed = false;
        }
      }
    }
  }

  // Build condensed output
  const summary = [];

  summary.push("## Session Stats");
  summary.push(
    `Tools: ${Array.from(toolStats.entries())
      .map(([k, v]) => `${k}(${v})`)
      .join(", ")}`
  );
  summary.push(`Files: ${filesEdited.size > 0 ? Array.from(filesEdited).join(", ") : "none"}`);
  summary.push(`Errors: ${errorCount}${hasRetryPattern ? " (retry pattern detected)" : ""}`);
  summary.push("");
  summary.push("## Session Flow");

  // Add parts, respecting max length
  let totalLen = summary.join("\n").length;
  for (const part of parts) {
    if (totalLen + part.length + 1 > MAX_CHARS) break;
    summary.push(part);
    totalLen += part.length + 1;
  }

  process.stdout.write(summary.join("\n"));
}

main().catch(() => process.exit(1));
