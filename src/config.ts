import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

export interface DeviceConfig {
  name: string;
  addedAt: string;
}

export interface CcmergeConfig {
  store: string;
  devices: DeviceConfig[];
}

const CONFIG_DIR = join(homedir(), ".ccmerge");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const CLAUDE_DIR = join(homedir(), ".claude");
export const CLAUDE_PROJECTS_DIR = join(CLAUDE_DIR, "projects");
export const STATS_CACHE_FILE = join(CLAUDE_DIR, "stats-cache.json");

export function getDefaultStore(): string {
  // Prefer iCloud if available on macOS
  const icloud = join(
    homedir(),
    "Library/Mobile Documents/com~apple~CloudDocs/ccmerge",
  );
  if (existsSync(join(homedir(), "Library/Mobile Documents/com~apple~CloudDocs"))) {
    return icloud;
  }
  return join(CONFIG_DIR, "store");
}

export function loadConfig(): CcmergeConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
}

export function saveConfig(config: CcmergeConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
