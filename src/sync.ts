import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join, dirname } from "path";
import {
  CLAUDE_PROJECTS_DIR,
  STATS_CACHE_FILE,
  deviceSessionsDir,
  devicesDir,
} from "./config.js";
import { scanSessions } from "./scanner.js";
import { gitPull, gitCommitAndPush } from "./git.js";

// --- Push ---

export interface PushResult {
  copied: number;
  skipped: number;
  totalSize: number;
  committed: boolean;
  pushed: boolean;
  error?: string;
}

/**
 * Push local sessions to the repo.
 * 1. Copy sessions from ~/.claude/projects/ → repo/devices/{device}/claude-sessions/
 * 2. git add + commit + push
 */
export function pushSessions(repoPath: string, device: string): PushResult {
  const targetDir = deviceSessionsDir(repoPath, device);
  mkdirSync(targetDir, { recursive: true });

  const localSessions = scanSessions(CLAUDE_PROJECTS_DIR);
  const manifestPath = join(repoPath, "devices", device, "manifest.json");
  const manifest = loadManifest(manifestPath);

  let copied = 0;
  let skipped = 0;
  let totalSize = 0;

  for (const session of localSessions) {
    const key = `${session.projectDir}/${session.sessionId}`;
    const prevMtime = manifest[key];

    if (prevMtime && new Date(prevMtime) >= session.mtime) {
      skipped++;
      continue;
    }

    // Copy .jsonl
    const dest = join(targetDir, session.projectDir);
    mkdirSync(dest, { recursive: true });
    copyFileSync(session.path, join(dest, `${session.sessionId}.jsonl`));
    totalSize += session.size;

    // Copy session dir (subagents/, tool-results/)
    if (session.sessionDir) {
      copyDirRecursive(session.sessionDir, join(dest, session.sessionId));
    }

    // Copy sessions-index.json
    const indexFile = join(CLAUDE_PROJECTS_DIR, session.projectDir, "sessions-index.json");
    if (existsSync(indexFile)) {
      copyFileSync(indexFile, join(dest, "sessions-index.json"));
    }

    manifest[key] = session.mtime.toISOString();
    copied++;
  }

  saveManifest(manifestPath, manifest);

  // Git commit + push
  if (copied === 0) {
    return { copied, skipped, totalSize, committed: false, pushed: false };
  }

  const msg = `sync(${device}): ${copied} session(s) updated`;
  const git = gitCommitAndPush(repoPath, msg);

  return {
    copied,
    skipped,
    totalSize,
    committed: git.committed,
    pushed: git.pushed,
    error: git.error,
  };
}

// --- Pull ---

export interface PullResult {
  gitPulled: boolean;
  sessionsCopied: number;
  sessionsSkipped: number;
  devices: string[];
  error?: string;
}

/**
 * Pull from remote, then deploy ALL device sessions into ~/.claude/projects/.
 * Copies sessions from ALL devices (including own) so /stats sees everything.
 */
export function pullSessions(repoPath: string): PullResult {
  // 1. git pull
  const pull = gitPull(repoPath);

  const devDir = devicesDir(repoPath);
  if (!existsSync(devDir)) {
    return { gitPulled: pull.ok, sessionsCopied: 0, sessionsSkipped: 0, devices: [], error: pull.ok ? undefined : pull.output };
  }

  let sessionsCopied = 0;
  let sessionsSkipped = 0;
  const deviceNames: string[] = [];

  // 2. Iterate ALL devices in repo
  for (const deviceDir of readdirSync(devDir)) {
    const sessionsDir = deviceSessionsDir(repoPath, deviceDir);
    if (!existsSync(sessionsDir) || !statSync(sessionsDir).isDirectory()) continue;

    deviceNames.push(deviceDir);
    const repoSessions = scanSessions(sessionsDir);

    for (const session of repoSessions) {
      const localJsonl = join(CLAUDE_PROJECTS_DIR, session.projectDir, `${session.sessionId}.jsonl`);

      // Skip if local is same or newer
      if (existsSync(localJsonl)) {
        const localStat = statSync(localJsonl);
        if (localStat.mtime >= session.mtime) {
          sessionsSkipped++;
          continue;
        }
      }

      // Ensure project directory
      const localProjectDir = join(CLAUDE_PROJECTS_DIR, session.projectDir);
      mkdirSync(localProjectDir, { recursive: true });
      ensureSessionsIndex(localProjectDir, session.projectDir);

      // Copy .jsonl
      copyFileSync(session.path, localJsonl);

      // Copy session dir
      if (session.sessionDir) {
        copyDirRecursive(session.sessionDir, join(localProjectDir, session.sessionId));
      }

      sessionsCopied++;
    }
  }

  // 3. Invalidate stats cache
  if (sessionsCopied > 0) {
    invalidateStatsCache();
  }

  return {
    gitPulled: pull.ok,
    sessionsCopied,
    sessionsSkipped,
    devices: deviceNames,
    error: pull.ok ? undefined : pull.output,
  };
}

export function invalidateStatsCache(): void {
  if (existsSync(STATS_CACHE_FILE)) {
    unlinkSync(STATS_CACHE_FILE);
  }
}

// --- Helpers ---

function ensureSessionsIndex(projectDir: string, encodedPath: string): void {
  const indexPath = join(projectDir, "sessions-index.json");
  if (existsSync(indexPath)) return;
  const originalPath = encodedPath.replace(/^-/, "/").replace(/-/g, "/");
  writeFileSync(indexPath, JSON.stringify({ version: 1, entries: [], originalPath }, null, 2));
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function loadManifest(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return {}; }
}

function saveManifest(path: string, data: Record<string, string>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}
