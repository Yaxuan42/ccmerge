# ccmerge

Merge Claude Code usage data across multiple devices so `/stats` and `/insights` work with all your sessions — not just the current machine.

[English](#the-problem) | [中文](#问题)

---

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

---

## 问题

Claude Code 的 `/stats` 和 `/insights` 只读取本机 `~/.claude/projects/` 目录下的数据。如果你在多台设备上使用 Claude Code（比如 Mac Mini + MacBook），每台设备只能看到自己的会话记录。

## 工作原理

`ccmerge` 通过一个共享存储（iCloud、rsync、NAS 等）在设备间同步会话 JSONL 文件：

```
Mac Mini                         MacBook
~/.claude/projects/ ──push──▶    ──push──▶
                            共享存储
~/.claude/projects/ ◀──pull──    ◀──pull──
```

拉取后自动删除 `stats-cache.json`，Claude Code 原生的 `/stats` 会从所有会话重新计算。`/insights` 直接读取 `~/.claude/projects/`，自动包含所有设备的数据。

**不搞单独的仪表盘，不造新的分析引擎。只做同步 — 然后照常使用 Claude Code。**

## 安装

```bash
npm i -g ccmerge
```

## 快速开始

在**两台**设备上执行，指向同一个共享存储：

```bash
# 使用 iCloud（macOS）
ccmerge init --store "~/Library/Mobile Documents/com~apple~CloudDocs/ccmerge" --device mac-mini
ccmerge init --store "~/Library/Mobile Documents/com~apple~CloudDocs/ccmerge" --device macbook

# 或使用任意共享目录（rsync、NAS 等）
ccmerge init --store /path/to/shared/ccmerge --device mac-mini
```

然后同步：

```bash
# 在每台设备上 — 推送本地，拉取远程
ccmerge sync

# 或分开执行
ccmerge push
ccmerge pull
```

现在在 Claude Code 中运行 `/stats` 或 `/insights` — 就能看到所有设备的数据了。

## 命令

| 命令 | 说明 |
|---|---|
| `ccmerge init` | 设置存储路径和设备名 |
| `ccmerge push` | 推送本地会话到共享存储 |
| `ccmerge pull` | 拉取其他设备的会话到本地 `~/.claude/` |
| `ccmerge sync` | 一步完成推送 + 拉取 |
| `ccmerge status` | 查看存储和设备概况 |
| `ccmerge reset-cache` | 强制 `/stats` 重新计算 |

## 参数

```
init:
  -s, --store <path>    共享存储路径（默认: iCloud 或 ~/.ccmerge/store）
  -d, --device <name>   设备名称（默认: 主机名）

push / pull / sync:
  -d, --device <name>   覆盖设备名称
```

## 同步机制

1. **Push** 将本地 `~/.claude/projects/**/*.jsonl`（及子代理/工具结果目录）复制到共享存储的 `store/{设备名}/projects/` 下。
2. **Pull** 将其他设备的会话从共享存储复制到本地 `~/.claude/projects/`。会话 ID 是 UUID — 不会冲突。
3. Pull 后删除 `stats-cache.json`，`/stats` 会从所有会话重新计算。
4. 使用 manifest 记录文件修改时间实现**增量同步** — 只复制有变化的会话。

### 同步内容

- 会话 JSONL 文件（完整对话记录）
- 子代理日志（`subagents/*.jsonl`）
- 工具结果文件（`tool-results/toolu_*.txt`）

### 隐私提示

会话 JSONL 文件包含完整的对话历史。请只使用你自己控制的共享存储（iCloud、本地 NAS、加密卷等）。

## 存储结构

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
