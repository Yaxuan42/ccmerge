import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { CLAUDE_PROJECTS_DIR } from "./config.js";
import { scanSessions } from "./scanner.js";

export interface DeviceStatus {
  name: string;
  sessionCount: number;
  totalSize: number;
  lastActivity: Date | null;
}

export interface StoreStatus {
  storePath: string;
  devices: DeviceStatus[];
  localSessions: number;
}

/**
 * Get status of the shared store and local sessions.
 */
export function getStatus(storePath: string): StoreStatus {
  const localSessions = scanSessions(CLAUDE_PROJECTS_DIR).length;
  const devices: DeviceStatus[] = [];

  if (!existsSync(storePath)) {
    return { storePath, devices, localSessions };
  }

  for (const deviceDir of readdirSync(storePath)) {
    const deviceProjectsDir = join(storePath, deviceDir, "projects");
    if (!existsSync(deviceProjectsDir) || !statSync(deviceProjectsDir).isDirectory()) {
      continue;
    }

    const sessions = scanSessions(deviceProjectsDir);
    const totalSize = sessions.reduce((sum, s) => sum + s.size, 0);
    const lastActivity = sessions.length > 0
      ? sessions.reduce((latest, s) => s.mtime > latest ? s.mtime : latest, sessions[0].mtime)
      : null;

    devices.push({
      name: deviceDir,
      sessionCount: sessions.length,
      totalSize,
      lastActivity,
    });
  }

  return { storePath, devices, localSessions };
}
