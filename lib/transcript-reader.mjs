import { readFile } from "node:fs/promises";

/**
 * Parse a JSONL transcript file into an array of message objects.
 */
export async function parseTranscript(filepath) {
  const raw = await readFile(filepath, "utf-8");
  const lines = raw.split("\n").filter((line) => line.trim());
  const messages = [];

  for (const line of lines) {
    try {
      messages.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return messages;
}

/**
 * Extract session statistics for heuristic filtering.
 */
export function getSessionStats(messages) {
  const toolUses = new Map();
  let messageCount = 0;
  let hasCodeChanges = false;

  for (const msg of messages) {
    messageCount++;

    const content = msg?.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === "tool_use") {
        const name = block.name || "unknown";
        toolUses.set(name, (toolUses.get(name) || 0) + 1);

        if (name === "Write" || name === "Edit") {
          hasCodeChanges = true;
        }
      }
    }
  }

  return {
    messageCount,
    toolUseCount: Array.from(toolUses.values()).reduce((a, b) => a + b, 0),
    toolTypes: Object.fromEntries(toolUses),
    hasCodeChanges,
  };
}
