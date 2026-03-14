import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".agent-blog");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const LOG_DIR = join(CONFIG_DIR, "logs");

export function isConfigured() {
  return existsSync(CONFIG_PATH);
}

export async function readConfig() {
  if (!isConfigured()) return null;
  const raw = await readFile(CONFIG_PATH, "utf-8");
  return JSON.parse(raw);
}

export async function writeConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(LOG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export { CONFIG_DIR, CONFIG_PATH, LOG_DIR };
