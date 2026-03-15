import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".agent-blog");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const LOG_DIR = join(CONFIG_DIR, "logs");

const CONFIG_DEFAULTS = {
  max_chars: 80000,
  growth_threshold: 0.2,
  max_tokens_between_checks: 200000,
  min_transcript_bytes: 5000,
  ignore_projects: [],
};

export function isConfigured() {
  return existsSync(CONFIG_PATH);
}

function expandHome(filepath) {
  if (filepath.startsWith("~/")) return join(homedir(), filepath.slice(2));
  if (filepath.startsWith("~")) return join(homedir(), filepath.slice(1));
  return filepath;
}

export async function readConfig() {
  if (!isConfigured()) return null;
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf-8"));
  if (config.blog_repo_path) {
    config.blog_repo_path = expandHome(config.blog_repo_path);
  }
  return { ...CONFIG_DEFAULTS, ...config };
}

export async function writeConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(LOG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function resolveAgentPath(phaseName, pluginRoot) {
  const userPath = join(homedir(), ".agent-blog", "templates", `${phaseName}.md`);
  if (existsSync(userPath)) return userPath;
  const defaultPath = join(pluginRoot, "templates", `${phaseName}.md`);
  if (existsSync(defaultPath)) return defaultPath;
  return null;
}

export { CONFIG_DIR, CONFIG_PATH, LOG_DIR, CONFIG_DEFAULTS };
