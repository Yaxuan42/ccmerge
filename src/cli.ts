#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { hostname } from "os";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import {
  loadConfig,
  saveConfig,
  DEFAULT_REPO_PATH,
  type CcmergeConfig,
} from "./config.js";
import { cloneRepo, initRepo, gitPull, setupLfs } from "./git.js";
import { pushSessions, pullSessions, invalidateStatsCache } from "./sync.js";
import { pushSkills, pullSkills, getSkillsStatus } from "./skills.js";
import { gitCommitAndPush } from "./git.js";
import { getStatusInfo } from "./status.js";

const program = new Command();

program
  .name("ccmerge")
  .description("Sync Claude Code sessions & skills across devices via GitHub")
  .version("0.3.0");

// ── init ──────────────────────────────────────────────────────────

program
  .command("init")
  .description("Clone sync repo, scaffold structure, configure LFS")
  .requiredOption("-r, --repo <url>", "GitHub repo URL (https or git@)")
  .option("-d, --device <name>", "Name for this device", hostname())
  .option("-p, --path <path>", "Local clone path", DEFAULT_REPO_PATH)
  .action((opts) => {
    const repoUrl: string = opts.repo;
    const device: string = opts.device;
    const repoPath: string = opts.path;

    console.log(chalk.dim(`Repo:   ${repoUrl}`));
    console.log(chalk.dim(`Device: ${device}`));
    console.log(chalk.dim(`Path:   ${repoPath}`));
    console.log();

    // Clone or detect existing
    try {
      const freshClone = cloneRepo(repoUrl, repoPath);
      if (freshClone) {
        console.log(chalk.green("Cloned repo."));
      } else {
        console.log(chalk.dim("Repo already cloned, pulling latest..."));
        gitPull(repoPath);
      }
    } catch {
      console.log(chalk.yellow("Remote not found. Initializing new repo locally..."));
      mkdirSync(repoPath, { recursive: true });
      initRepo(repoPath, repoUrl);
    }

    // Setup LFS
    const lfsOk = setupLfs(repoPath);
    if (lfsOk) {
      console.log(chalk.green("git-lfs configured") + chalk.dim(" (*.jsonl tracked)"));
    } else {
      console.log(chalk.yellow("git-lfs not available. Install with: brew install git-lfs"));
    }

    // Scaffold repo structure
    scaffoldRepo(repoPath, device);

    // Save local config
    saveConfig({ repo: repoUrl, repoPath, device });

    console.log();
    console.log(chalk.green("ccmerge initialized."));
    console.log(chalk.dim("Next: run `ccmerge push` or `ccmerge sync`."));
  });

// ── push ──────────────────────────────────────────────────────────

program
  .command("push")
  .description("Copy local sessions + skills to repo, git commit & push")
  .option("--sessions-only", "Only push sessions")
  .option("--skills-only", "Only push skills")
  .action((opts) => {
    const config = requireConfig();
    const { repoPath, device } = config;
    const doSessions = !opts.skillsOnly;
    const doSkills = !opts.sessionsOnly;

    const parts: string[] = [];

    // Sessions
    if (doSessions) {
      console.log(chalk.dim(`Pushing sessions as "${device}"...`));
      const sr = pushSessions(repoPath, device);
      if (sr.copied > 0) {
        console.log(chalk.green(`  ${sr.copied} session(s) copied`) + chalk.dim(` (${sr.skipped} unchanged, ${fmtBytes(sr.totalSize)})`));
        parts.push(`${sr.copied} sessions`);
      } else {
        console.log(chalk.dim(`  ${sr.skipped} session(s) up to date`));
      }
    }

    // Skills
    if (doSkills) {
      console.log(chalk.dim("Pushing skills..."));
      const sk = pushSkills(repoPath);
      if (sk.skillsCopied > 0) {
        console.log(chalk.green(`  ${sk.skillsCopied} skill(s) copied`) + chalk.dim(` (${sk.skillsSkipped} unchanged)`));
        parts.push(`${sk.skillsCopied} skills`);
      } else {
        console.log(chalk.dim(`  ${sk.skillsSkipped} skill(s) up to date`));
      }
      if (sk.lockCopied) {
        console.log(chalk.dim("  skill-lock.json synced"));
      }
    }

    // Git commit + push
    if (parts.length > 0) {
      const msg = `sync(${device}): ${parts.join(", ")} updated`;
      const git = gitCommitAndPush(repoPath, msg);
      if (git.pushed) {
        console.log(chalk.green("Committed & pushed to GitHub."));
      } else if (git.committed) {
        console.log(chalk.yellow("Committed locally, push failed: ") + chalk.dim(git.error || ""));
      }
    } else {
      // skill-lock.json might have changed even if no skills changed
      const msg = `sync(${device}): update metadata`;
      const git = gitCommitAndPush(repoPath, msg);
      if (git.pushed) {
        console.log(chalk.dim("Metadata pushed."));
      } else if (!git.committed) {
        console.log(chalk.dim("Nothing to push."));
      }
    }
  });

// ── pull ──────────────────────────────────────────────────────────

program
  .command("pull")
  .description("Git pull, deploy sessions to ~/.claude/, symlink skills")
  .option("--sessions-only", "Only pull sessions")
  .option("--skills-only", "Only pull skills")
  .action((opts) => {
    const config = requireConfig();
    const doSessions = !opts.skillsOnly;
    const doSkills = !opts.sessionsOnly;

    console.log(chalk.dim("Pulling from GitHub..."));

    // Sessions
    if (doSessions) {
      const sr = pullSessions(config.repoPath);
      if (!sr.gitPulled && sr.error) {
        console.log(chalk.yellow("  git pull warning: ") + chalk.dim(sr.error));
      }
      if (sr.sessionsCopied > 0) {
        console.log(chalk.green(`  ${sr.sessionsCopied} session(s) deployed`) + chalk.dim(` from [${sr.devices.join(", ")}]`));
        console.log(chalk.yellow("  stats-cache.json invalidated"));
      } else if (sr.devices.length > 0) {
        console.log(chalk.dim(`  sessions up to date (${sr.sessionsSkipped} from [${sr.devices.join(", ")}])`));
      } else {
        console.log(chalk.dim("  no device sessions in repo"));
      }
    }

    // Skills
    if (doSkills) {
      const sk = pullSkills(config.repoPath);
      if (sk.skillsLinked > 0) {
        console.log(
          chalk.green(`  ${sk.skillsLinked} skill(s) linked`) +
          chalk.dim(` → Claude Code`) +
          (sk.openclawLinked ? chalk.dim(` + OpenClaw`) : ""),
        );
      } else if (sk.skillsSkipped > 0) {
        console.log(chalk.dim(`  ${sk.skillsSkipped} skill(s) already linked`));
      }
      if (sk.lockCopied) {
        console.log(chalk.dim("  skill-lock.json updated. Run `claude skill install` to sync third-party skills."));
      }
    }
  });

// ── sync ──────────────────────────────────────────────────────────

program
  .command("sync")
  .description("Pull + push (recommended daily workflow)")
  .option("--sessions-only", "Only sync sessions")
  .option("--skills-only", "Only sync skills")
  .action((opts) => {
    const config = requireConfig();
    const { device, repoPath } = config;
    const doSessions = !opts.skillsOnly;
    const doSkills = !opts.sessionsOnly;

    // Pull first
    console.log(chalk.bold("pull"));
    const pullGit = gitPull(repoPath);
    if (!pullGit.ok) {
      console.log(chalk.yellow("  git pull warning: ") + chalk.dim(pullGit.output));
    }

    if (doSessions) {
      const sr = pullSessions(repoPath);
      if (sr.sessionsCopied > 0) {
        console.log(chalk.green(`  ${sr.sessionsCopied} session(s) deployed`) + chalk.dim(` [${sr.devices.join(", ")}]`));
      } else {
        console.log(chalk.dim("  sessions up to date"));
      }
    }

    if (doSkills) {
      const sk = pullSkills(repoPath);
      if (sk.skillsLinked > 0) {
        console.log(chalk.green(`  ${sk.skillsLinked} skill(s) linked`));
      } else {
        console.log(chalk.dim("  skills up to date"));
      }
    }

    // Push
    console.log(chalk.bold("push"));
    const parts: string[] = [];

    if (doSessions) {
      const sr = pushSessions(repoPath, device);
      if (sr.copied > 0) {
        console.log(chalk.green(`  ${sr.copied} session(s) copied`));
        parts.push(`${sr.copied} sessions`);
      } else {
        console.log(chalk.dim("  sessions up to date"));
      }
    }

    if (doSkills) {
      const sk = pushSkills(repoPath);
      if (sk.skillsCopied > 0) {
        console.log(chalk.green(`  ${sk.skillsCopied} skill(s) copied`));
        parts.push(`${sk.skillsCopied} skills`);
      } else {
        console.log(chalk.dim("  skills up to date"));
      }
    }

    // Commit + push
    const msg = parts.length > 0
      ? `sync(${device}): ${parts.join(", ")} updated`
      : `sync(${device}): update metadata`;
    const git = gitCommitAndPush(repoPath, msg);
    if (git.pushed) {
      console.log(chalk.green("  pushed"));
    } else if (!git.committed) {
      console.log(chalk.dim("  nothing to push"));
    }

    console.log();
    console.log(chalk.green("Sync complete."));
  });

// ── status ────────────────────────────────────────────────────────

program
  .command("status")
  .description("Show repo, device, skill, and local session status")
  .action(() => {
    const config = requireConfig();
    const info = getStatusInfo(config.repoPath);
    const skills = getSkillsStatus(config.repoPath);

    // Repo info
    console.log(chalk.bold("Repo:    ") + chalk.cyan(config.repo));
    console.log(chalk.bold("Path:    ") + chalk.dim(info.repoPath));
    console.log(chalk.bold("Branch:  ") + info.branch + (info.clean ? chalk.green(" (clean)") : chalk.yellow(` (${info.changes} changes)`)));
    console.log(chalk.bold("Device:  ") + chalk.cyan(config.device));
    if (info.lastCommit) {
      console.log(chalk.bold("Last:    ") + chalk.dim(`${info.lastCommit.hash} ${info.lastCommit.message} (${info.lastCommit.date})`));
    }
    console.log();

    // Sessions table
    if (info.devices.length === 0) {
      console.log(chalk.yellow("No device sessions in repo yet. Run `ccmerge push`."));
    } else {
      const table = new Table({
        head: ["Device", "Sessions", "Size", "Last Activity"],
        style: { head: ["cyan"] },
      });

      let totalSessions = 0;
      let totalSize = 0;
      for (const d of info.devices) {
        totalSessions += d.sessionCount;
        totalSize += d.totalSize;
        table.push([
          d.name === config.device ? chalk.green(d.name + " *") : d.name,
          String(d.sessionCount),
          fmtBytes(d.totalSize),
          d.lastActivity ? d.lastActivity.toLocaleDateString() : "-",
        ]);
      }
      table.push([
        chalk.bold("Total (repo)"),
        chalk.bold(String(totalSessions)),
        chalk.bold(fmtBytes(totalSize)),
        "",
      ]);
      console.log(table.toString());
    }

    // Skills info
    console.log();
    console.log(chalk.bold("Skills:"));
    console.log(`  Repo:       ${skills.repoSkillCount} custom skill(s)` + (skills.hasLock ? chalk.dim(" + skill-lock.json") : ""));
    console.log(`  Claude Code: ${skills.claudeLinked} linked`);
    if (skills.openclawLinked > 0) {
      console.log(`  OpenClaw:   ${skills.openclawLinked} linked`);
    }

    console.log();
    console.log(chalk.bold("Local ~/.claude/projects/:  ") + `${info.localMergedSessions} sessions (merged)`);
  });

// ── reset-cache ───────────────────────────────────────────────────

program
  .command("reset-cache")
  .description("Delete stats-cache.json to force /stats recalculation")
  .action(() => {
    invalidateStatsCache();
    console.log(chalk.green("stats-cache.json deleted. /stats will recalculate."));
  });

// ── helpers ───────────────────────────────────────────────────────

function requireConfig(): CcmergeConfig {
  const config = loadConfig();
  if (!config) {
    console.error(chalk.red("Not initialized. Run: ccmerge init --repo <url>"));
    process.exit(1);
  }
  return config;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function scaffoldRepo(repoPath: string, device: string): void {
  const devSessions = join(repoPath, "devices", device, "claude-sessions");
  mkdirSync(devSessions, { recursive: true });

  // .gitignore
  const gi = join(repoPath, ".gitignore");
  if (!existsSync(gi)) {
    writeFileSync(gi, [
      "# Secrets",
      ".env",
      "*.pem",
      "*.key",
      "",
      "# OS",
      ".DS_Store",
      "Thumbs.db",
      "",
    ].join("\n"));
  }

  // .gitattributes — LFS for JSONL
  const ga = join(repoPath, ".gitattributes");
  const gaContent = [
    "# Track session logs with git-lfs",
    "*.jsonl filter=lfs diff=lfs merge=lfs -text",
    "",
  ].join("\n");
  // Update existing file if it has the old binary-only rule
  if (!existsSync(ga) || !readFileSync(ga, "utf-8").includes("filter=lfs")) {
    writeFileSync(ga, gaContent);
  }

  // skills/ placeholder
  const skillsDir = join(repoPath, "skills");
  mkdirSync(skillsDir, { recursive: true });
  const skillsKeep = join(skillsDir, ".gitkeep");
  if (!existsSync(skillsKeep)) {
    writeFileSync(skillsKeep, "");
  }
}

program.parse();
