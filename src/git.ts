import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function runSafe(cmd: string, cwd: string): { ok: boolean; output: string } {
  try {
    return { ok: true, output: run(cmd, cwd) };
  } catch (e: any) {
    return { ok: false, output: e.stderr?.toString() || e.message };
  }
}

/** Clone a repo. Returns true if cloned, false if already exists. */
export function cloneRepo(repoUrl: string, targetPath: string): boolean {
  if (existsSync(join(targetPath, ".git"))) {
    return false;
  }
  execSync(`git clone "${repoUrl}" "${targetPath}"`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return true;
}

/** Initialize a new repo (for first-time setup when no remote exists yet). */
export function initRepo(targetPath: string, repoUrl: string): void {
  execSync(`git init "${targetPath}"`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  run(`git remote add origin "${repoUrl}"`, targetPath);
}

/** Set up git-lfs tracking for *.jsonl in the repo. */
export function setupLfs(repoPath: string): boolean {
  const hasLfs = runSafe("git lfs version", repoPath);
  if (!hasLfs.ok) return false;
  runSafe("git lfs install --local", repoPath);
  runSafe("git lfs track '*.jsonl'", repoPath);
  return true;
}

/** Pull latest from remote. Returns {ok, output}. */
export function gitPull(repoPath: string): { ok: boolean; output: string } {
  // Check if remote has any commits first
  const branch = getCurrentBranch(repoPath);
  const hasRemote = runSafe(`git ls-remote --heads origin ${branch}`, repoPath);
  if (!hasRemote.ok || !hasRemote.output) {
    return { ok: true, output: "No remote commits yet" };
  }
  return runSafe("git pull --rebase origin " + branch, repoPath);
}

/** Stage all changes, commit, and push. */
export function gitCommitAndPush(
  repoPath: string,
  message: string,
): { committed: boolean; pushed: boolean; error?: string } {
  // Stage all changes in repo
  run("git add -A", repoPath);

  // Check if there's anything to commit
  const status = run("git status --porcelain", repoPath);
  if (!status) {
    return { committed: false, pushed: false };
  }

  // Commit
  run(`git commit -m "${message.replace(/"/g, '\\"')}"`, repoPath);

  // Push
  const branch = getCurrentBranch(repoPath);
  const pushResult = runSafe(`git push -u origin ${branch}`, repoPath);
  if (!pushResult.ok) {
    return { committed: true, pushed: false, error: pushResult.output };
  }

  return { committed: true, pushed: true };
}

/** Get current branch name */
export function getCurrentBranch(repoPath: string): string {
  try {
    return run("git branch --show-current", repoPath) || "main";
  } catch {
    return "main";
  }
}

/** Get short status: clean, dirty, or uncommitted count */
export function getRepoStatus(repoPath: string): { clean: boolean; changes: number; branch: string } {
  const branch = getCurrentBranch(repoPath);
  const status = run("git status --porcelain", repoPath);
  const lines = status ? status.split("\n").filter(Boolean) : [];
  return { clean: lines.length === 0, changes: lines.length, branch };
}

/** Get the last commit info */
export function getLastCommit(repoPath: string): { hash: string; message: string; date: string } | null {
  try {
    const log = run('git log -1 --format="%h|%s|%ci"', repoPath);
    const [hash, message, date] = log.split("|");
    return { hash, message, date };
  } catch {
    return null;
  }
}
