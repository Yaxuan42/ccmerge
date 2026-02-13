import { existsSync, readdirSync, statSync } from "fs";
import { CLAUDE_PROJECTS_DIR, devicesDir, deviceSessionsDir } from "./config.js";
import { scanSessions } from "./scanner.js";
import { getRepoStatus, getLastCommit } from "./git.js";

export interface DeviceStatus {
  name: string;
  sessionCount: number;
  totalSize: number;
  lastActivity: Date | null;
}

export interface RepoStatusInfo {
  repoPath: string;
  branch: string;
  clean: boolean;
  changes: number;
  lastCommit: { hash: string; message: string; date: string } | null;
  devices: DeviceStatus[];
  localMergedSessions: number;
}

export function getStatusInfo(repoPath: string): RepoStatusInfo {
  const localMergedSessions = scanSessions(CLAUDE_PROJECTS_DIR).length;
  const { branch, clean, changes } = getRepoStatus(repoPath);
  const lastCommit = getLastCommit(repoPath);
  const devices: DeviceStatus[] = [];

  const devDir = devicesDir(repoPath);
  if (existsSync(devDir)) {
    for (const dir of readdirSync(devDir)) {
      const sessDir = deviceSessionsDir(repoPath, dir);
      if (!existsSync(sessDir) || !statSync(sessDir).isDirectory()) continue;

      const sessions = scanSessions(sessDir);
      const totalSize = sessions.reduce((sum, s) => sum + s.size, 0);
      const lastActivity = sessions.length > 0
        ? sessions.reduce((latest, s) => s.mtime > latest ? s.mtime : latest, sessions[0].mtime)
        : null;

      devices.push({ name: dir, sessionCount: sessions.length, totalSize, lastActivity });
    }
  }

  return { repoPath, branch, clean, changes, lastCommit, devices, localMergedSessions };
}
