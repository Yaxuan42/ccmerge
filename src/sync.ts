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
import { join, relative, dirname } from "path";
import { CLAUDE_PROJECTS_DIR, STATS_CACHE_FILE } from "./config.js";
import { scanSessions, type SessionFile } from "./scanner.js";

export interface PushResult {
  pushed: number;
  skipped: number;
  totalSize: number;
}

export interface PullResult {
  pulled: number;
  skipped: number;
  devices: string[];
}

/**
 * Push local sessions to the shared store.
 * Layout in store: store/{deviceName}/projects/{projectDir}/{sessionId}.jsonl
 */
export function pushToStore(
  storePath: string,
  deviceName: string,
): PushResult {
  const deviceDir = join(storePath, deviceName, "projects");
  mkdirSync(deviceDir, { recursive: true });

  const localSessions = scanSessions(CLAUDE_PROJECTS_DIR);

  // Load push manifest to track what we've already pushed
  const manifestPath = join(storePath, deviceName, "manifest.json");
  const manifest = loadManifest(manifestPath);

  let pushed = 0;
  let skipped = 0;
  let totalSize = 0;

  for (const session of localSessions) {
    const key = `${session.projectDir}/${session.sessionId}`;
    const prevMtime = manifest[key];

    // Skip if file hasn't changed since last push
    if (prevMtime && new Date(prevMtime) >= session.mtime) {
      skipped++;
      continue;
    }

    // Copy .jsonl file
    const targetDir = join(deviceDir, session.projectDir);
    mkdirSync(targetDir, { recursive: true });
    const targetJsonl = join(targetDir, `${session.sessionId}.jsonl`);
    copyFileSync(session.path, targetJsonl);
    totalSize += session.size;

    // Copy session directory (subagents, tool-results) if exists
    if (session.sessionDir) {
      copyDirRecursive(session.sessionDir, join(targetDir, session.sessionId));
    }

    // Copy sessions-index.json if exists
    const indexFile = join(CLAUDE_PROJECTS_DIR, session.projectDir, "sessions-index.json");
    if (existsSync(indexFile)) {
      copyFileSync(indexFile, join(targetDir, "sessions-index.json"));
    }

    manifest[key] = session.mtime.toISOString();
    pushed++;
  }

  saveManifest(manifestPath, manifest);

  return { pushed, skipped, totalSize };
}

/**
 * Pull remote device sessions into local ~/.claude/projects/.
 * Only pulls sessions from OTHER devices (skips own device).
 */
export function pullFromStore(
  storePath: string,
  localDeviceName: string,
): PullResult {
  if (!existsSync(storePath)) {
    throw new Error(`Store not found: ${storePath}`);
  }

  let pulled = 0;
  let skipped = 0;
  const devices: string[] = [];

  for (const deviceDir of readdirSync(storePath)) {
    // Skip own device
    if (deviceDir === localDeviceName) continue;

    const deviceProjectsDir = join(storePath, deviceDir, "projects");
    if (!existsSync(deviceProjectsDir) || !statSync(deviceProjectsDir).isDirectory()) {
      continue;
    }

    devices.push(deviceDir);
    const remoteSessions = scanSessions(deviceProjectsDir);

    for (const session of remoteSessions) {
      const localJsonl = join(
        CLAUDE_PROJECTS_DIR,
        session.projectDir,
        `${session.sessionId}.jsonl`,
      );

      // Skip if already exists locally and is same or newer
      if (existsSync(localJsonl)) {
        const localStat = statSync(localJsonl);
        if (localStat.mtime >= session.mtime) {
          skipped++;
          continue;
        }
      }

      // Ensure project directory exists
      const localProjectDir = join(CLAUDE_PROJECTS_DIR, session.projectDir);
      mkdirSync(localProjectDir, { recursive: true });

      // Ensure sessions-index.json exists
      ensureSessionsIndex(localProjectDir, session.projectDir);

      // Copy .jsonl file
      copyFileSync(session.path, localJsonl);

      // Copy session directory if exists
      if (session.sessionDir) {
        copyDirRecursive(
          session.sessionDir,
          join(localProjectDir, session.sessionId),
        );
      }

      pulled++;
    }
  }

  // Invalidate stats cache so /stats recalculates with merged data
  if (pulled > 0) {
    invalidateStatsCache();
  }

  return { pulled, skipped, devices };
}

/**
 * Delete stats-cache.json to force /stats to recalculate from all sessions.
 */
export function invalidateStatsCache(): void {
  if (existsSync(STATS_CACHE_FILE)) {
    unlinkSync(STATS_CACHE_FILE);
  }
}

/**
 * Ensure a sessions-index.json exists for a project directory.
 * Claude Code needs this file to discover sessions.
 */
function ensureSessionsIndex(projectDir: string, encodedPath: string): void {
  const indexPath = join(projectDir, "sessions-index.json");
  if (existsSync(indexPath)) return;

  // Decode the project path: "-Users-yaxuan-foo" → "/Users/yaxuan/foo"
  const originalPath = encodedPath.replace(/^-/, "/").replace(/-/g, "/");

  writeFileSync(
    indexPath,
    JSON.stringify(
      { version: 1, entries: [], originalPath },
      null,
      2,
    ),
  );
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
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveManifest(path: string, data: Record<string, string>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}
