# ccmerge

Merge Claude Code usage data across multiple devices so `/stats` and `/insights` work with all your sessions — not just the current machine.

## The Problem

Claude Code's `/stats` and `/insights` only read from the local `~/.claude/projects/` directory. If you use Claude Code on multiple devices (e.g. a Mac Mini and a MacBook), each device only sees its own sessions.

## How It Works

`ccmerge` syncs session JSONL files between devices through a shared store (iCloud, rsync, NAS, etc.):

```
Mac Mini                         MacBook
~/.claude/projects/ ──push──▶    ──push──▶
                            Shared Store
~/.claude/projects/ ◀──pull──    ◀──pull──
```

After pulling, it deletes `stats-cache.json` so Claude Code's native `/stats` recalculates with all sessions. `/insights` automatically picks up all sessions since it reads directly from `~/.claude/projects/`.

**No separate dashboard. No new analytics engine. Just sync — then use Claude Code normally.**

## Install

```bash
npm i -g ccmerge
```

## Quick Start

Run on **both** devices, pointing to the same shared store:

```bash
# Using iCloud (macOS)
ccmerge init --store "~/Library/Mobile Documents/com~apple~CloudDocs/ccmerge" --device mac-mini
ccmerge init --store "~/Library/Mobile Documents/com~apple~CloudDocs/ccmerge" --device macbook

# Or using any shared directory (rsync, NAS, etc.)
ccmerge init --store /path/to/shared/ccmerge --device mac-mini
```

Then sync:

```bash
# On each device — push local, pull remote
ccmerge sync

# Or separately
ccmerge push
ccmerge pull
```

Now run `/stats` or `/insights` in Claude Code — you'll see data from all devices.

## Commands

| Command | Description |
|---|---|
| `ccmerge init` | Set up store path and device name |
| `ccmerge push` | Push local sessions to the shared store |
| `ccmerge pull` | Pull other devices' sessions into local `~/.claude/` |
| `ccmerge sync` | Push + pull in one step |
| `ccmerge status` | Show store and device overview |
| `ccmerge reset-cache` | Force `/stats` to recalculate |

## Options

```
init:
  -s, --store <path>    Shared store path (default: iCloud or ~/.ccmerge/store)
  -d, --device <name>   Name for this device (default: hostname)

push / pull / sync:
  -d, --device <name>   Override device name
```

## How Sync Works

1. **Push** copies your local `~/.claude/projects/**/*.jsonl` (and subagent/tool-result dirs) to the shared store under `store/{device}/projects/`.
2. **Pull** copies other devices' sessions from the store into your local `~/.claude/projects/`. Session IDs are UUIDs — no conflicts.
3. After pull, `stats-cache.json` is deleted so `/stats` recalculates from all sessions.
4. A manifest tracks file mtimes for **incremental sync** — only changed sessions are copied.

### What Gets Synced

- Session JSONL files (full conversation logs)
- Subagent logs (`subagents/*.jsonl`)
- Tool result files (`tool-results/toolu_*.txt`)

### Privacy Note

Session JSONL files contain your full conversation history. Only use shared stores you control (iCloud, local NAS, encrypted volume, etc.).

## Store Layout

```
store/
├── mac-mini/
│   ├── manifest.json
│   └── projects/
│       ├── -Users-yaxuan/
│       │   ├── {session-id}.jsonl
│       │   └── {session-id}/subagents/...
│       └── -Users-yaxuan-myproject/...
└── macbook/
    ├── manifest.json
    └── projects/...
```

## License

MIT
