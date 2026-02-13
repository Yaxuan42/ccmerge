import { readdirSync, statSync, existsSync } from "fs";
import { join, basename } from "path";

export interface SessionFile {
  /** Absolute path to the .jsonl file */
  path: string;
  /** Session UUID */
  sessionId: string;
  /** Encoded project path (e.g. "-Users-yaxuan-myproject") */
  projectDir: string;
  /** Optional session directory containing subagents/ and tool-results/ */
  sessionDir: string | null;
  /** File modification time */
  mtime: Date;
  /** File size in bytes */
  size: number;
}

/**
 * Scan ~/.claude/projects/ and find all session .jsonl files.
 *
 * Structure:
 *   projects/{projectDir}/{sessionId}.jsonl           (flat file)
 *   projects/{projectDir}/{sessionId}/subagents/...   (session dir)
 */
export function scanSessions(projectsDir: string): SessionFile[] {
  if (!existsSync(projectsDir)) return [];

  const sessions: SessionFile[] = [];

  for (const projectDir of readdirSync(projectsDir)) {
    const projectPath = join(projectsDir, projectDir);
    if (!statSync(projectPath).isDirectory()) continue;

    for (const entry of readdirSync(projectPath)) {
      // Match {uuid}.jsonl files
      if (!entry.endsWith(".jsonl")) continue;
      const sessionId = basename(entry, ".jsonl");
      if (!isUUID(sessionId)) continue;

      const jsonlPath = join(projectPath, entry);
      const stat = statSync(jsonlPath);

      // Check if there's a corresponding session directory
      const dirPath = join(projectPath, sessionId);
      const sessionDir = existsSync(dirPath) && statSync(dirPath).isDirectory()
        ? dirPath
        : null;

      sessions.push({
        path: jsonlPath,
        sessionId,
        projectDir,
        sessionDir,
        mtime: stat.mtime,
        size: stat.size,
      });
    }
  }

  return sessions;
}

function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
