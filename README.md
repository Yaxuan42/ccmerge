# ccmerge

Sync Claude Code sessions and skills across devices via GitHub — so `/stats` and `/insights` see everything.

[English](#the-problem) | [中文](#问题)

---

## The Problem

Claude Code's `/stats` and `/insights` only read from local `~/.claude/projects/`. If you use Claude Code on multiple devices, each device is blind to the other.

Custom skills have the same problem: create a skill on your desktop, and your laptop doesn't have it. Neither does OpenClaw.

## How It Works

`ccmerge` uses a **private GitHub repo** as the sync backend. Every change is a git commit — trackable, auditable, rollback-able.

```
Mac Mini                              MacBook
~/.claude/projects/ ──push──▶  GitHub  ◀──push── ~/.claude/projects/
~/.claude/skills/   ──push──▶  (repo)  ◀──push── ~/.claude/skills/
                    ◀──pull──          ──pull──▶
```

After pulling:
- Sessions land in `~/.claude/projects/` — `/stats` and `/insights` work natively
- Skills are symlinked to `~/.claude/skills/` and `~/.openclaw/skills/` — both tools discover them

**No dashboard. No database. Just git.**

## Install

```bash
npm i -g ccmerge
```

Prerequisites: `git`, `git-lfs` (`brew install git-lfs`)

## Quick Start

```bash
# 1. Create a private repo on GitHub (e.g. Yaxuan42/cc-sync)

# 2. Init on each device
ccmerge init --repo https://github.com/YOU/cc-sync.git --device mac-mini
ccmerge init --repo https://github.com/YOU/cc-sync.git --device macbook

# 3. Daily workflow — one command
ccmerge sync
```

Now run `/stats` or `/insights` in Claude Code — data from all devices.

## Commands

| Command | Description |
|---|---|
| `ccmerge init --repo <url>` | Clone sync repo, scaffold structure, configure LFS |
| `ccmerge push` | Copy local sessions + skills to repo, git commit & push |
| `ccmerge pull` | Git pull, deploy sessions to `~/.claude/`, symlink skills |
| `ccmerge sync` | Pull + push in one step (recommended) |
| `ccmerge status` | Show repo state, per-device stats, skill counts |
| `ccmerge reset-cache` | Force `/stats` to recalculate |

## Options

```
init:
  -r, --repo <url>      GitHub repo URL (required)
  -d, --device <name>   Device name (default: hostname)
  -p, --path <path>     Local clone path (default: ~/.ccmerge/repo)

push / pull / sync:
  --sessions-only       Only sync sessions
  --skills-only         Only sync skills
```

## What Gets Synced

### Sessions (per device, no conflicts)

```
repo/devices/{device}/claude-sessions/
  {project-dir}/{session-id}.jsonl
  {project-dir}/{session-id}/subagents/...
```

- JSONL files tracked by git-lfs (keeps repo size manageable)
- Each device writes to its own directory — UUID-based, zero conflict risk
- Manifest tracks mtimes for incremental sync

### Skills (shared, both tools)

```
repo/skills/
  feishu-doc/SKILL.md
  my-skill.md
  ...
repo/skill-lock.json              # third-party skill manifest
```

- **Custom skills**: actual files synced to `repo/skills/`, then symlinked to:
  - `~/.claude/skills/{name}` (Claude Code)
  - `~/.openclaw/skills/{name}` (OpenClaw, auto-detected)
- **Third-party skills**: only `skill-lock.json` is synced (like `package-lock.json`). Run `claude skill install` on the other device to install them.

### OpenClaw Compatibility

Skills use `SKILL.md` with YAML frontmatter — compatible with both Claude Code and OpenClaw. OpenClaw-specific metadata goes in the frontmatter:

```yaml
---
name: my-skill
description: When to use this skill...
metadata:
  openclaw:
    emoji: "🔧"
    always: false
---
```

Claude Code ignores `metadata.openclaw`. OpenClaw reads it. One file, both tools.

## Repo Layout

```
cc-sync/                          # Private GitHub repo
├── .gitattributes                # *.jsonl filter=lfs
├── .gitignore
├── devices/
│   ├── mac-mini/
│   │   ├── manifest.json
│   │   └── claude-sessions/
│   │       └── {project-dir}/{session}.jsonl
│   └── macbook/
│       └── ...
├── skills/                       # Custom skills (shared)
│   ├── feishu-doc/
│   │   └── SKILL.md
│   └── my-skill.md
└── skill-lock.json               # Third-party skill manifest
```

## Privacy & Security

- The sync repo **must be private**. Session logs contain full conversation history.
- `.gitignore` excludes `.env`, `*.pem`, `*.key` by default.
- JSONL files are tracked via git-lfs — not stored inline in git objects.

## License

MIT

---

## 问题

Claude Code 的 `/stats` 和 `/insights` 只读取本机 `~/.claude/projects/`。多设备使用时，每台设备只能看到自己的数据。

自定义 Skills 也一样：在台式机创建的 skill，笔记本上没有，OpenClaw 也没有。

## 工作原理

`ccmerge` 用一个**私有 GitHub 仓库**作为同步后端。每次变更都是 git commit — 可追踪、可审计、可回滚。

```
Mac Mini                              MacBook
~/.claude/projects/ ──push──▶  GitHub  ◀──push── ~/.claude/projects/
~/.claude/skills/   ──push──▶  (repo)  ◀──push── ~/.claude/skills/
                    ◀──pull──          ──pull──▶
```

Pull 后：
- Sessions 部署到 `~/.claude/projects/` — `/stats` 和 `/insights` 原生工作
- Skills 通过 symlink 指向 `~/.claude/skills/` 和 `~/.openclaw/skills/` — 两个工具都能发现

**不造仪表盘，不造数据库。只用 git。**

## 安装

```bash
npm i -g ccmerge
```

前置依赖：`git`、`git-lfs`（`brew install git-lfs`）

## 快速开始

```bash
# 1. 在 GitHub 创建一个私有仓库（如 Yaxuan42/cc-sync）

# 2. 在每台设备上初始化
ccmerge init --repo https://github.com/YOU/cc-sync.git --device mac-mini
ccmerge init --repo https://github.com/YOU/cc-sync.git --device macbook

# 3. 日常工作流 — 一条命令
ccmerge sync
```

现在在 Claude Code 中运行 `/stats` 或 `/insights` — 所有设备的数据都在。

## 命令

| 命令 | 说明 |
|---|---|
| `ccmerge init --repo <url>` | 克隆同步仓库，初始化目录结构，配置 LFS |
| `ccmerge push` | 复制本地 sessions + skills 到仓库，git commit & push |
| `ccmerge pull` | Git pull，部署 sessions 到 `~/.claude/`，symlink skills |
| `ccmerge sync` | 一步完成 pull + push（推荐） |
| `ccmerge status` | 显示仓库状态、各设备统计、skill 数量 |
| `ccmerge reset-cache` | 强制 `/stats` 重新计算 |

## 参数

```
init:
  -r, --repo <url>      GitHub 仓库 URL（必填）
  -d, --device <name>   设备名称（默认: 主机名）
  -p, --path <path>     本地克隆路径（默认: ~/.ccmerge/repo）

push / pull / sync:
  --sessions-only       只同步 sessions
  --skills-only         只同步 skills
```

## 同步内容

### Sessions（按设备隔离，无冲突）

- JSONL 文件通过 git-lfs 追踪（控制仓库体积）
- 每台设备写自己的目录 — UUID 天然不冲突
- Manifest 记录 mtime 实现增量同步

### Skills（共享，双工具通用）

- **自定义 skills**：实际文件同步到 `repo/skills/`，然后 symlink 到：
  - `~/.claude/skills/{name}`（Claude Code）
  - `~/.openclaw/skills/{name}`（OpenClaw，自动检测）
- **三方 skills**：只同步 `skill-lock.json`（类似 `package-lock.json`）。另一台设备执行 `claude skill install` 即可安装。

### OpenClaw 兼容

Skills 使用 `SKILL.md` + YAML frontmatter，Claude Code 和 OpenClaw 都兼容。OpenClaw 专属元数据放在 frontmatter 中，Claude Code 会忽略它。

## 隐私与安全

- 同步仓库**必须是私有的**。Session 日志包含完整对话历史。
- `.gitignore` 默认排除 `.env`、`*.pem`、`*.key`。
- JSONL 通过 git-lfs 追踪，不以内联方式存储在 git 对象中。

## License

MIT
