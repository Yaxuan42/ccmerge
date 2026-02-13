import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

// --- repo-based config ---

export interface CcmergeConfig {
  /** GitHub repo URL (e.g. "https://github.com/Yaxuan42/cc-sync.git") */
  repo: string;
  /** Local clone path */
  repoPath: string;
  /** This device's name */
  device: string;
}

const CONFIG_DIR = join(homedir(), ".ccmerge");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const CLAUDE_DIR = join(homedir(), ".claude");
export const CLAUDE_PROJECTS_DIR = join(CLAUDE_DIR, "projects");
export const STATS_CACHE_FILE = join(CLAUDE_DIR, "stats-cache.json");

export const DEFAULT_REPO_PATH = join(CONFIG_DIR, "repo");

/** Get the devices directory inside the repo */
export function devicesDir(repoPath: string): string {
  return join(repoPath, "devices");
}

/** Get this device's sessions directory inside the repo */
export function deviceSessionsDir(repoPath: string, device: string): string {
  return join(repoPath, "devices", device, "claude-sessions");
}

export function loadConfig(): CcmergeConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export function saveConfig(config: CcmergeConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
