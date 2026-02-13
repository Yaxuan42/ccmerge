import {
  existsSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  statSync,
  copyFileSync,
  symlinkSync,
  unlinkSync,
  lstatSync,
} from "fs";
import { join, resolve } from "path";
import {
  CLAUDE_SKILLS_DIR,
  OPENCLAW_SKILLS_DIR,
  AGENTS_SKILLS_DIR,
  SKILL_LOCK_FILE,
} from "./config.js";

// --- Push ---

export interface SkillsPushResult {
  skillsCopied: number;
  skillsSkipped: number;
  lockCopied: boolean;
}

/**
 * Push custom skills + skill-lock.json to the repo.
 * Custom skills = entries in ~/.claude/skills/ NOT pointing to ~/.agents/skills/
 */
export function pushSkills(repoPath: string): SkillsPushResult {
  const repoSkillsDir = join(repoPath, "skills");
  mkdirSync(repoSkillsDir, { recursive: true });

  let skillsCopied = 0;
  let skillsSkipped = 0;

  if (existsSync(CLAUDE_SKILLS_DIR)) {
    for (const entry of readdirSync(CLAUDE_SKILLS_DIR)) {
      const entryPath = join(CLAUDE_SKILLS_DIR, entry);

      // Resolve symlink target to determine if custom or third-party
      if (isThirdPartySkill(entryPath)) {
        continue; // Skip third-party skills
      }

      // Resolve to actual content
      const realPath = resolveSkillPath(entryPath);
      if (!realPath || !existsSync(realPath)) continue;

      const targetPath = join(repoSkillsDir, entry);

      if (statSync(realPath).isDirectory()) {
        // Check if changed (compare mtime of SKILL.md)
        const srcSkillMd = join(realPath, "SKILL.md");
        const dstSkillMd = join(targetPath, "SKILL.md");
        if (existsSync(dstSkillMd) && existsSync(srcSkillMd)) {
          if (statSync(dstSkillMd).mtime >= statSync(srcSkillMd).mtime) {
            skillsSkipped++;
            continue;
          }
        }
        copyDirRecursive(realPath, targetPath);
        skillsCopied++;
      } else {
        // Single file skill
        if (existsSync(targetPath) && statSync(targetPath).mtime >= statSync(realPath).mtime) {
          skillsSkipped++;
          continue;
        }
        copyFileSync(realPath, targetPath);
        skillsCopied++;
      }
    }
  }

  // Copy skill-lock.json
  let lockCopied = false;
  if (existsSync(SKILL_LOCK_FILE)) {
    const dest = join(repoPath, "skill-lock.json");
    copyFileSync(SKILL_LOCK_FILE, dest);
    lockCopied = true;
  }

  return { skillsCopied, skillsSkipped, lockCopied };
}

// --- Pull ---

export interface SkillsPullResult {
  skillsLinked: number;
  skillsSkipped: number;
  openclawLinked: boolean;
  lockCopied: boolean;
}

/**
 * Pull skills from repo: create symlinks in ~/.claude/skills/ and ~/.openclaw/skills/
 */
export function pullSkills(repoPath: string): SkillsPullResult {
  const repoSkillsDir = join(repoPath, "skills");
  if (!existsSync(repoSkillsDir)) {
    return { skillsLinked: 0, skillsSkipped: 0, openclawLinked: false, lockCopied: false };
  }

  let skillsLinked = 0;
  let skillsSkipped = 0;
  const hasOpenclaw = existsSync(OPENCLAW_SKILLS_DIR);

  for (const entry of readdirSync(repoSkillsDir)) {
    if (entry === ".gitkeep") continue;

    const repoSkillPath = join(repoSkillsDir, entry);

    // Claude Code symlink
    const claudeLink = join(CLAUDE_SKILLS_DIR, entry);
    const linked = ensureSymlink(repoSkillPath, claudeLink);

    // OpenClaw symlink (if exists)
    if (hasOpenclaw) {
      ensureSymlink(repoSkillPath, join(OPENCLAW_SKILLS_DIR, entry));
    }

    if (linked) {
      skillsLinked++;
    } else {
      skillsSkipped++;
    }
  }

  // Copy skill-lock.json to ~/.agents/.skill-lock.json
  let lockCopied = false;
  const repoLock = join(repoPath, "skill-lock.json");
  if (existsSync(repoLock)) {
    // Only copy if repo version is newer
    if (!existsSync(SKILL_LOCK_FILE) || statSync(repoLock).mtime > statSync(SKILL_LOCK_FILE).mtime) {
      copyFileSync(repoLock, SKILL_LOCK_FILE);
      lockCopied = true;
    }
  }

  return { skillsLinked, skillsSkipped, openclawLinked: hasOpenclaw, lockCopied };
}

// --- Status ---

export interface SkillsStatusInfo {
  repoSkillCount: number;
  claudeLinked: number;
  openclawLinked: number;
  hasLock: boolean;
}

export function getSkillsStatus(repoPath: string): SkillsStatusInfo {
  const repoSkillsDir = join(repoPath, "skills");
  let repoSkillCount = 0;

  if (existsSync(repoSkillsDir)) {
    repoSkillCount = readdirSync(repoSkillsDir).filter((e) => e !== ".gitkeep").length;
  }

  // Count symlinks pointing to our repo
  let claudeLinked = 0;
  if (existsSync(CLAUDE_SKILLS_DIR)) {
    for (const entry of readdirSync(CLAUDE_SKILLS_DIR)) {
      try {
        const target = readlinkSync(join(CLAUDE_SKILLS_DIR, entry));
        if (resolve(CLAUDE_SKILLS_DIR, target).startsWith(repoPath)) {
          claudeLinked++;
        }
      } catch { /* not a symlink */ }
    }
  }

  let openclawLinked = 0;
  if (existsSync(OPENCLAW_SKILLS_DIR)) {
    for (const entry of readdirSync(OPENCLAW_SKILLS_DIR)) {
      try {
        const target = readlinkSync(join(OPENCLAW_SKILLS_DIR, entry));
        if (resolve(OPENCLAW_SKILLS_DIR, target).startsWith(repoPath)) {
          openclawLinked++;
        }
      } catch { /* not a symlink */ }
    }
  }

  return {
    repoSkillCount,
    claudeLinked,
    openclawLinked,
    hasLock: existsSync(join(repoPath, "skill-lock.json")),
  };
}

// --- Helpers ---

function isThirdPartySkill(entryPath: string): boolean {
  try {
    const target = readlinkSync(entryPath);
    const resolved = resolve(join(CLAUDE_SKILLS_DIR), target);
    return resolved.startsWith(AGENTS_SKILLS_DIR);
  } catch {
    return false; // Not a symlink — treat as custom
  }
}

function resolveSkillPath(entryPath: string): string | null {
  try {
    // Follow symlinks to get the real path
    const target = readlinkSync(entryPath);
    return resolve(join(CLAUDE_SKILLS_DIR), target);
  } catch {
    // Not a symlink — the entry itself is the content
    return entryPath;
  }
}

function ensureSymlink(target: string, linkPath: string): boolean {
  // If link already points to the right place, skip
  try {
    const existing = readlinkSync(linkPath);
    if (resolve(join(CLAUDE_SKILLS_DIR), existing) === resolve(target)) {
      return false;
    }
    // Points elsewhere — remove and recreate
    unlinkSync(linkPath);
  } catch {
    // Not a symlink or doesn't exist
    if (existsSync(linkPath)) {
      // It's a regular file/dir — don't overwrite
      return false;
    }
  }

  mkdirSync(join(linkPath, ".."), { recursive: true });
  symlinkSync(target, linkPath);
  return true;
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
