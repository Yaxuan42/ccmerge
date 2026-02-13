#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { hostname } from "os";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  loadConfig,
  saveConfig,
  DEFAULT_REPO_PATH,
  type CcmergeConfig,
} from "./config.js";
import { cloneRepo, initRepo, gitPull } from "./git.js";
import { pushSessions, pullSessions, invalidateStatsCache } from "./sync.js";
import { getStatusInfo } from "./status.js";

const program = new Command();

program
  .name("ccmerge")
  .description("Merge Claude Code sessions across devices via GitHub for unified /stats and /insights")
  .version("0.2.0");

// ── init ──────────────────────────────────────────────────────────

program
  .command("init")
  .description("Initialize ccmerge: clone (or create) a GitHub sync repo")
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
    let freshClone = false;
    try {
      freshClone = cloneRepo(repoUrl, repoPath);
      if (freshClone) {
        console.log(chalk.green("Cloned repo."));
      } else {
        console.log(chalk.dim("Repo already cloned, pulling latest..."));
        gitPull(repoPath);
      }
    } catch (e: any) {
      // Clone failed — repo might not exist on GitHub yet. Init locally.
      console.log(chalk.yellow("Remote not found. Initializing new repo locally..."));
      mkdirSync(repoPath, { recursive: true });
      initRepo(repoPath, repoUrl);
      freshClone = true;
    }

    // Scaffold repo structure
    scaffoldRepo(repoPath, device);

    // Save local config
    saveConfig({ repo: repoUrl, repoPath, device });

    console.log();
    console.log(chalk.green("ccmerge initialized."));
    console.log(chalk.dim("Next: run `ccmerge push` to push local sessions, or `ccmerge sync`."));
  });

// ── push ──────────────────────────────────────────────────────────

program
  .command("push")
  .description("Copy local sessions to repo and git push")
  .action(() => {
    const config = requireConfig();

    console.log(chalk.dim(`Pushing sessions as "${config.device}"...`));
    const result = pushSessions(config.repoPath, config.device);

    if (result.copied === 0) {
      console.log(chalk.dim(`All ${result.skipped} session(s) up to date. Nothing to push.`));
      return;
    }

    console.log(
      chalk.green(`Copied ${result.copied} session(s)`) +
      chalk.dim(` (${result.skipped} unchanged, ${fmtBytes(result.totalSize)})`),
    );

    if (result.pushed) {
      console.log(chalk.green("Committed & pushed to GitHub."));
    } else if (result.committed) {
      console.log(chalk.yellow("Committed locally, but push failed: ") + chalk.dim(result.error || ""));
    }
  });

// ── pull ──────────────────────────────────────────────────────────

program
  .command("pull")
  .description("Git pull and deploy all device sessions into ~/.claude/projects/")
  .action(() => {
    const config = requireConfig();

    console.log(chalk.dim("Pulling from GitHub..."));
    const result = pullSessions(config.repoPath);

    if (!result.gitPulled && result.error) {
      console.log(chalk.yellow("Git pull warning: ") + chalk.dim(result.error));
    }

    if (result.devices.length === 0) {
      console.log(chalk.yellow("No device sessions found in repo."));
      return;
    }

    if (result.sessionsCopied > 0) {
      console.log(
        chalk.green(`Deployed ${result.sessionsCopied} session(s)`) +
        chalk.dim(` from [${result.devices.join(", ")}]`) +
        chalk.dim(` (${result.sessionsSkipped} unchanged)`),
      );
      console.log(chalk.yellow("stats-cache.json invalidated — /stats will recalculate."));
    } else {
      console.log(
        chalk.dim(`All sessions up to date (${result.sessionsSkipped} from [${result.devices.join(", ")}]).`),
      );
    }
  });

// ── sync ──────────────────────────────────────────────────────────

program
  .command("sync")
  .description("Pull remote + push local (recommended daily workflow)")
  .action(() => {
    const config = requireConfig();
    const { device, repoPath } = config;

    // Pull first (get others' changes before pushing ours)
    console.log(chalk.bold("pull"));
    const pullResult = pullSessions(repoPath);

    if (!pullResult.gitPulled && pullResult.error) {
      console.log(chalk.yellow("  git pull warning: ") + chalk.dim(pullResult.error));
    }
    if (pullResult.sessionsCopied > 0) {
      console.log(chalk.green(`  ${pullResult.sessionsCopied} session(s) deployed`) + chalk.dim(` from [${pullResult.devices.join(", ")}]`));
    } else {
      console.log(chalk.dim("  up to date"));
    }

    // Push
    console.log(chalk.bold("push"));
    const pushResult = pushSessions(repoPath, device);

    if (pushResult.copied > 0) {
      console.log(chalk.green(`  ${pushResult.copied} session(s) copied → `) + (pushResult.pushed ? chalk.green("pushed") : chalk.yellow("committed (push failed)")));
    } else {
      console.log(chalk.dim("  nothing to push"));
    }

    console.log();
    if (pullResult.sessionsCopied > 0) {
      console.log(chalk.yellow("stats-cache invalidated.") + chalk.dim(" Run /stats or /insights in Claude Code."));
    } else {
      console.log(chalk.green("Sync complete."));
    }
  });

// ── status ────────────────────────────────────────────────────────

program
  .command("status")
  .description("Show repo, device, and local session status")
  .action(() => {
    const config = requireConfig();
    const info = getStatusInfo(config.repoPath);

    // Repo info
    console.log(chalk.bold("Repo:    ") + chalk.cyan(config.repo));
    console.log(chalk.bold("Path:    ") + chalk.dim(info.repoPath));
    console.log(chalk.bold("Branch:  ") + info.branch + (info.clean ? chalk.green(" (clean)") : chalk.yellow(` (${info.changes} changes)`)));
    console.log(chalk.bold("Device:  ") + chalk.cyan(config.device));
    if (info.lastCommit) {
      console.log(chalk.bold("Last:    ") + chalk.dim(`${info.lastCommit.hash} ${info.lastCommit.message} (${info.lastCommit.date})`));
    }
    console.log();

    // Device sessions table
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

/**
 * Ensure repo has the expected directory structure + .gitignore + .gitattributes.
 */
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

  // .gitattributes — treat JSONL as binary (no diff, no merge)
  const ga = join(repoPath, ".gitattributes");
  if (!existsSync(ga)) {
    writeFileSync(ga, [
      "# Treat session logs as binary (no line-level diff/merge)",
      "*.jsonl binary",
      "",
    ].join("\n"));
  }

  // skills/ placeholder
  const skillsDir = join(repoPath, "skills");
  mkdirSync(skillsDir, { recursive: true });
  const skillsReadme = join(skillsDir, ".gitkeep");
  if (!existsSync(skillsReadme)) {
    writeFileSync(skillsReadme, "");
  }
}

program.parse();
