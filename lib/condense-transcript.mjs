#!/usr/bin/env node

/**
 * Reads a JSONL transcript and outputs a condensed summary suitable for
 * Haiku triage. Extracts the narrative arc: what was the goal, what was
 * tried, what changed, what was the outcome.
 *
 * Run manually: node condense-transcript.mjs /path/to/transcript.jsonl
 */

import { readFile } from "node:fs/promises";

const MAX_CHARS = 16000; // ~4K tokens — enough for Haiku to understand the session

async function main() {
  const transcriptPath = process.argv[2];
  if (!transcriptPath) {
    console.error("Usage: node condense-transcript.mjs <transcript.jsonl>");
    process.exit(1);
  }

  const raw = await readFile(transcriptPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());

  const events = [];
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
      // User messages — capture the intent/questions
      if (block.type === "text" && msg.role === "user") {
        const text = block.text?.trim();
        if (text && text.length > 10) {
          events.push({ type: "user", text: text.slice(0, 500), priority: 3 });
        }
      }

      // Assistant reasoning — the narrative
      if (block.type === "text" && msg.role === "assistant") {
        const text = block.text?.trim();
        if (text && text.length > 20) {
          events.push({ type: "assistant", text: text.slice(0, 800), priority: 2 });
        }
      }

      // Tool uses — what actions were taken
      if (block.type === "tool_use") {
        const name = block.name || "unknown";
        toolStats.set(name, (toolStats.get(name) || 0) + 1);

        const input = block.input || {};
        if (input.file_path) filesEdited.add(input.file_path);

        if (name === "Edit" || name === "Write") {
          // Capture what was changed (old→new for Edit, first lines for Write)
          const desc = input.description || input.file_path || "";
          const oldStr = input.old_string ? input.old_string.slice(0, 200) : "";
          const newStr = input.new_string ? input.new_string.slice(0, 200) : "";
          const content = input.content ? input.content.slice(0, 200) : "";

          if (oldStr && newStr) {
            events.push({ type: "edit", text: `[Edit ${desc}] "${oldStr}" → "${newStr}"`, priority: 1 });
          } else if (content) {
            events.push({ type: "write", text: `[Write ${input.file_path || ""}] ${content}`, priority: 1 });
          }
        } else if (name === "Bash") {
          events.push({ type: "bash", text: `[Bash] ${(input.command || "").slice(0, 200)}`, priority: 1 });
        } else if (name === "Read" || name === "Glob" || name === "Grep") {
          events.push({ type: "search", text: `[${name}] ${input.file_path || input.pattern || input.command || ""}`, priority: 0 });
        }
      }

      // Tool results — capture interesting outcomes
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

        if (
          block.is_error ||
          /error|fail|exception|traceback|panic/i.test(text.slice(0, 500))
        ) {
          errorCount++;
          if (lastToolFailed) hasRetryPattern = true;
          lastToolFailed = true;
          events.push({ type: "error", text: `[error] ${text.slice(0, 300)}`, priority: 3 });
        } else {
          lastToolFailed = false;
          // Capture non-trivial successful results (test output, build output, etc.)
          if (text.length > 50 && /test|pass|assert|bench|perf|time|ms\b|success/i.test(text.slice(0, 500))) {
            events.push({ type: "result", text: `[result] ${text.slice(0, 300)}`, priority: 1 });
          }
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
  if (filesEdited.size > 0) {
    summary.push(`Files touched: ${Array.from(filesEdited).join(", ")}`);
  }
  summary.push(`Errors: ${errorCount}${hasRetryPattern ? " (retry pattern detected)" : ""}`);
  summary.push("");
  summary.push("## Session Flow");

  // Budget allocation: prioritize higher priority events but keep chronological order
  // First pass: include all high-priority events (errors, user messages)
  // Second pass: fill remaining space with lower-priority events
  let totalLen = summary.join("\n").length;
  const included = new Set();

  // Pass 1: high priority (3) — user intent, errors
  for (let i = 0; i < events.length; i++) {
    if (events[i].priority >= 3 && totalLen + events[i].text.length + 1 <= MAX_CHARS) {
      summary.push(events[i].text);
      totalLen += events[i].text.length + 1;
      included.add(i);
    }
  }

  // Pass 2: everything else in chronological order
  for (let i = 0; i < events.length; i++) {
    if (included.has(i)) continue;
    if (totalLen + events[i].text.length + 1 > MAX_CHARS) continue;
    summary.push(events[i].text);
    totalLen += events[i].text.length + 1;
  }

  process.stdout.write(summary.join("\n"));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
