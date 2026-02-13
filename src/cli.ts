#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { hostname } from "os";
import {
  loadConfig,
  saveConfig,
  getDefaultStore,
  type CcmergeConfig,
} from "./config.js";
import { pushToStore, pullFromStore, invalidateStatsCache } from "./sync.js";
import { getStatus } from "./status.js";

const program = new Command();

program
  .name("ccmerge")
  .description("Merge Claude Code usage data across devices for unified /stats and /insights")
  .version("0.1.0");

// --- init ---
program
  .command("init")
  .description("Initialize ccmerge with a shared store path")
  .option("-s, --store <path>", "Path to shared store (default: iCloud or ~/.ccmerge/store)")
  .option("-d, --device <name>", "Name for this device", hostname())
  .action((opts) => {
    const storePath = opts.store || getDefaultStore();
    const deviceName = opts.device;

    const existing = loadConfig();
    if (existing) {
      console.log(chalk.yellow("Config already exists. Updating..."));
    }

    const config: CcmergeConfig = {
      store: storePath,
      devices: existing?.devices || [{ name: deviceName, addedAt: new Date().toISOString() }],
    };

    // Add device if not already in list
    if (!config.devices.find((d) => d.name === deviceName)) {
      config.devices.push({ name: deviceName, addedAt: new Date().toISOString() });
    }

    saveConfig(config);

    console.log(chalk.green("Initialized ccmerge"));
    console.log(`  Store: ${chalk.cyan(storePath)}`);
    console.log(`  Device: ${chalk.cyan(deviceName)}`);
    console.log();
    console.log(chalk.dim("Run the same command on your other device(s) with the same --store path."));
  });

// --- push ---
program
  .command("push")
  .description("Push local sessions to the shared store")
  .option("-d, --device <name>", "Device name override")
  .action((opts) => {
    const config = requireConfig();
    const deviceName = opts.device || config.devices[0]?.name || hostname();

    console.log(chalk.dim(`Pushing sessions from ${deviceName}...`));
    const result = pushToStore(config.store, deviceName);

    console.log(
      chalk.green(`Pushed ${result.pushed} session(s)`) +
      chalk.dim(` (${result.skipped} unchanged, ${formatBytes(result.totalSize)} total)`),
    );
  });

// --- pull ---
program
  .command("pull")
  .description("Pull remote sessions into local ~/.claude/projects/")
  .option("-d, --device <name>", "Local device name")
  .action((opts) => {
    const config = requireConfig();
    const deviceName = opts.device || config.devices[0]?.name || hostname();

    console.log(chalk.dim(`Pulling sessions from other devices...`));
    const result = pullFromStore(config.store, deviceName);

    if (result.pulled > 0) {
      console.log(
        chalk.green(`Pulled ${result.pulled} session(s)`) +
        chalk.dim(` from ${result.devices.join(", ")}`) +
        chalk.dim(` (${result.skipped} unchanged)`),
      );
      console.log(chalk.yellow("stats-cache.json invalidated — /stats will recalculate on next run."));
    } else if (result.devices.length === 0) {
      console.log(chalk.yellow("No other devices found in store. Push from your other device first."));
    } else {
      console.log(chalk.dim(`All sessions up to date (${result.skipped} checked).`));
    }
  });

// --- sync ---
program
  .command("sync")
  .description("Push local + pull remote (bidirectional sync)")
  .option("-d, --device <name>", "Local device name")
  .action((opts) => {
    const config = requireConfig();
    const deviceName = opts.device || config.devices[0]?.name || hostname();

    // Push first, then pull
    console.log(chalk.dim("--- push ---"));
    const pushResult = pushToStore(config.store, deviceName);
    console.log(
      chalk.green(`Pushed ${pushResult.pushed}`) +
      chalk.dim(` (${pushResult.skipped} unchanged)`),
    );

    console.log(chalk.dim("--- pull ---"));
    const pullResult = pullFromStore(config.store, deviceName);
    if (pullResult.pulled > 0) {
      console.log(
        chalk.green(`Pulled ${pullResult.pulled}`) +
        chalk.dim(` from ${pullResult.devices.join(", ")}`),
      );
      console.log(chalk.yellow("stats-cache.json invalidated."));
    } else {
      console.log(chalk.dim("Already up to date."));
    }

    console.log();
    console.log(chalk.green("Sync complete.") + chalk.dim(" Run /stats or /insights in Claude Code."));
  });

// --- status ---
program
  .command("status")
  .description("Show store and device status")
  .action(() => {
    const config = requireConfig();
    const status = getStatus(config.store);

    console.log(chalk.bold("Store: ") + chalk.cyan(status.storePath));
    console.log(chalk.bold("Local sessions: ") + String(status.localSessions));
    console.log();

    if (status.devices.length === 0) {
      console.log(chalk.yellow("No devices have pushed yet."));
      return;
    }

    const table = new Table({
      head: ["Device", "Sessions", "Size", "Last Activity"],
      style: { head: ["cyan"] },
    });

    for (const d of status.devices) {
      table.push([
        d.name,
        String(d.sessionCount),
        formatBytes(d.totalSize),
        d.lastActivity ? d.lastActivity.toLocaleDateString() : "-",
      ]);
    }

    console.log(table.toString());
  });

// --- reset ---
program
  .command("reset-cache")
  .description("Delete stats-cache.json to force /stats recalculation")
  .action(() => {
    invalidateStatsCache();
    console.log(chalk.green("stats-cache.json deleted. /stats will recalculate on next run."));
  });

// --- helpers ---
function requireConfig(): CcmergeConfig {
  const config = loadConfig();
  if (!config) {
    console.error(chalk.red("Not initialized. Run: ccmerge init"));
    process.exit(1);
  }
  return config;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

program.parse();
