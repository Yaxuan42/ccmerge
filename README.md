# ccmerge

[![npm version](https://img.shields.io/npm/v/@yaxuan42/ccmerge)](https://www.npmjs.com/package/@yaxuan42/ccmerge)
[![license](https://img.shields.io/npm/l/@yaxuan42/ccmerge)](./LICENSE)
[![node](https://img.shields.io/node/v/@yaxuan42/ccmerge)](https://nodejs.org)

**Git-native sync for Claude Code sessions & skills across devices — `/stats` and `/insights` see everything, everywhere.**

[English](#why) | [中文](#为什么)

---

## Why

Claude Code stores sessions in `~/.claude/projects/` and custom skills in `~/.claude/skills/`. Both are local-only. Use Claude Code on multiple machines, and each one is blind to the other — `/stats` shows half the picture, skills exist on one device but not the other.

**ccmerge** fixes this. One private GitHub repo as the sync backend. Every change is a git commit — trackable, auditable, rollback-able.

```
Mac Mini                              MacBook
~/.claude/projects/ ──push──▶  GitHub  ◀──push── ~/.claude/projects/
~/.claude/skills/   ──push──▶  (repo)  ◀──push── ~/.claude/skills/
                    ◀──pull──          ──pull──▶
```

After sync: `/stats` and `/insights` see all devices. Skills work everywhere.

**No dashboard. No database. No cloud backend. Just git.**

## What ccmerge does NOT do

- No web dashboard or UI
- No token usage analysis
- No cloud service or hosted backend
- No daemon or background process
- No encryption layer (relies on GitHub private repo access control)

---

## Install

```bash
npm i -g @yaxuan42/ccmerge
# or try without installing:
npx @yaxuan42/ccmerge --help
```

Prerequisites: Node.js >= 18, `git`, `git-lfs` (`brew install git-lfs`)

## Quick Start

```bash
# 1. Create a PRIVATE repo on GitHub (e.g. you/cc-sync)

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
| `ccmerge init --repo <url>` | Clone sync repo, check visibility, scaffold structure, configure LFS |
| `ccmerge push` | Secret scan → copy sessions + skills → git commit & push |
| `ccmerge pull` | Git pull → deploy sessions to `~/.claude/` → symlink skills |
| `ccmerge sync` | Pull → scan → push (recommended) |
| `ccmerge scan` | Run secret scan without pushing |
| `ccmerge status` | Show repo state, per-device stats, skill counts |
| `ccmerge reset-cache` | Force `/stats` to recalculate |

## Options

```
init:
  -r, --repo <url>           GitHub repo URL (required)
  -d, --device <name>        Device name (default: hostname)
  -p, --path <path>          Local clone path (default: ~/.ccmerge/repo)
  --i-know-what-im-doing     Allow public repos (dangerous)

push / sync:
  --sessions-only            Only sync sessions
  --skills-only              Only sync skills
  --skip-scan                Skip pre-push secret scan (not recommended)

pull:
  --sessions-only            Only pull sessions
  --skills-only              Only pull skills
```

---

## Security

### Private repo requirement

Session logs contain **full conversation history** — code, prompts, tool outputs. The sync repo **must be private**.

During `ccmerge init`:
- If `gh` CLI is available, ccmerge checks repo visibility automatically
- **Public repo** → blocked. Must pass `--i-know-what-im-doing` to proceed
- **Unknown** (gh unavailable) → strong warning

### Pre-push secret scan

Every `ccmerge push` and `ccmerge sync` runs a secret scan **before** committing. Only changed/new files are scanned (not the entire repo).

Detected patterns:
| Pattern | Example prefix |
|---|---|
| AWS Access Key | `AKIA...` |
| AWS Secret Key | `aws_secret_access_key = ...` |
| GitHub Token | `ghp_...` |
| GitHub PAT | `github_pat_...` |
| OpenAI API Key | `sk-...` |
| Google API Key | `AIza...` |
| Slack Token | `xox[bpras]-...` |
| SSH Private Key | `-----BEGIN ... PRIVATE KEY-----` |
| Generic secrets | `password="..."`, `api_key='...'` |

When a secret is found:
- Push is **blocked**
- Output: file path, line number, pattern type, redacted snippet (secret value is never printed in full)

Options to proceed:
1. Remove the secret and retry
2. Add to `.ccmerge-ignore-secrets` (see below)
3. `--skip-scan` to force (prints strong warning)

### `.ccmerge-ignore-secrets`

Place in the sync repo root. One rule per line:

```
# Ignore a specific file path
path:devices/old/test-data.json

# Ignore a specific pattern
rule:generic-secret
```

### Enhanced `.gitignore`

`ccmerge init` automatically adds these to the sync repo's `.gitignore`:

```
.env, .env.*, .env.local, .env.*.local
*.pem, *.key, *.p12, *.pfx
id_rsa*, id_ed25519*, id_ecdsa*
credentials.json, token.json, service-account*.json
```

### Risk acknowledgment

ccmerge syncs session data via a private GitHub repo. Understand the implications:
- Anyone with repo access can see your full conversation history
- GitHub stores data on their servers (subject to GitHub's terms)
- If the repo becomes public (accidentally or otherwise), all history is exposed
- git-lfs is used for `.jsonl` files, but they are still accessible to repo collaborators

---

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

- **Custom skills**: files synced to `repo/skills/`, then symlinked to:
  - `~/.claude/skills/{name}` (Claude Code)
  - `~/.openclaw/skills/{name}` (OpenClaw, auto-detected)
- **Third-party skills**: only `skill-lock.json` is synced. Run `claude skill install` on the other device.

### OpenClaw Compatibility

Skills use `SKILL.md` with YAML frontmatter — compatible with both Claude Code and OpenClaw. OpenClaw-specific metadata goes in frontmatter; Claude Code ignores it.

---

## Auto Sync Setup

ccmerge doesn't run as a daemon. Use system tools to automate:

### Git hook (post-commit)

```bash
# In your project repo's .git/hooks/post-commit:
#!/bin/sh
ccmerge sync 2>/dev/null &
```

> If you explicitly want to skip the pre-push secret scan (not recommended):
> `ccmerge sync --skip-scan 2>/dev/null &`

### Cron (every 30 min)

```bash
# crontab -e
*/30 * * * * /usr/local/bin/ccmerge sync 2>&1 >> ~/.ccmerge/sync.log
```

### macOS launchd

```xml
<!-- ~/Library/LaunchAgents/com.ccmerge.sync.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ccmerge.sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/ccmerge</string>
    <string>sync</string>
  </array>
  <key>StartInterval</key>
  <integer>1800</integer>
  <key>StandardOutPath</key>
  <string>/tmp/ccmerge-sync.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/ccmerge-sync.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.ccmerge.sync.plist
```

---

## Repo Layout

```
cc-sync/                          # Private GitHub repo
├── .gitattributes                # *.jsonl filter=lfs
├── .gitignore                    # Enhanced security entries
├── .ccmerge-ignore-secrets       # (optional) ignore rules
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

---

## FAQ

**Q: Can I use a public repo?**
A: Strongly discouraged. Session logs contain full conversation history. `ccmerge init` blocks public repos by default — you must pass `--i-know-what-im-doing` to override.

**Q: What if the secret scan gives a false positive?**
A: Add the file or pattern to `.ccmerge-ignore-secrets`. Use `rule:<pattern-id>` to disable a specific pattern, or `path:<file>` to skip a specific file.

**Q: Does ccmerge read or modify my Claude Code conversations?**
A: No. ccmerge copies `.jsonl` files as-is. It never parses, modifies, or deletes conversation content.

**Q: Can two devices push at the same time?**
A: Each device writes to `devices/{device-name}/`. UUID-based session IDs mean zero conflict risk. Git handles the rest.

**Q: How big will the repo get?**
A: JSONL files are tracked by git-lfs, which keeps the git history lean. Actual storage depends on GitHub's LFS quota (free tier: 1 GB storage, 1 GB/month bandwidth).

**Q: Does ccmerge work with non-GitHub remotes?**
A: It should work with any git remote. The `gh` CLI integration (repo visibility check) is GitHub-specific but optional.

**Q: What happens if I lose the repo?**
A: Local data in `~/.claude/projects/` is untouched. Re-create the repo and push again.

---

## License

MIT

---

## 为什么

Claude Code 的会话数据存在 `~/.claude/projects/`，自定义 Skills 存在 `~/.claude/skills/`。都是本地的。在多台设备上用 Claude Code，每台设备只能看到自己的数据 —— `/stats` 只显示一半，Skills 只存在于一台机器上。

**ccmerge** 解决这个问题。用一个私有 GitHub 仓库做同步后端。每次变更都是 git commit —— 可追踪、可审计、可回滚。

```
Mac Mini                              MacBook
~/.claude/projects/ ──push──▶  GitHub  ◀──push── ~/.claude/projects/
~/.claude/skills/   ──push──▶  (repo)  ◀──push── ~/.claude/skills/
                    ◀──pull──          ──pull──▶
```

同步后：`/stats` 和 `/insights` 看到所有设备的数据。Skills 在每台设备上都能用。

**不造仪表盘，不造数据库，不造云后端。只用 git。**

## ccmerge 不做什么

- 不做 Web 仪表盘或 UI
- 不做 Token 用量分析
- 不做云服务或托管后端
- 不做守护进程
- 不做加密层（依赖 GitHub 私有仓库的访问控制）

---

## 安装

```bash
npm i -g @yaxuan42/ccmerge
# 或者不安装直接试用：
npx @yaxuan42/ccmerge --help
```

前置依赖：Node.js >= 18、`git`、`git-lfs`（`brew install git-lfs`）

## 快速开始

```bash
# 1. 在 GitHub 创建一个私有仓库（如 you/cc-sync）

# 2. 在每台设备上初始化
ccmerge init --repo https://github.com/YOU/cc-sync.git --device mac-mini
ccmerge init --repo https://github.com/YOU/cc-sync.git --device macbook

# 3. 日常工作流 —— 一条命令
ccmerge sync
```

在 Claude Code 中运行 `/stats` 或 `/insights` —— 所有设备的数据都在了。

## 命令

| 命令 | 说明 |
|---|---|
| `ccmerge init --repo <url>` | 克隆同步仓库，检查可见性，初始化目录结构，配置 LFS |
| `ccmerge push` | Secret 扫描 → 复制 sessions + skills → git commit & push |
| `ccmerge pull` | Git pull → 部署 sessions 到 `~/.claude/` → symlink skills |
| `ccmerge sync` | Pull → 扫描 → push（推荐） |
| `ccmerge scan` | 只运行 Secret 扫描（不 push） |
| `ccmerge status` | 显示仓库状态、各设备统计、skill 数量 |
| `ccmerge reset-cache` | 强制 `/stats` 重新计算 |

## 参数

```
init:
  -r, --repo <url>           GitHub 仓库 URL（必填）
  -d, --device <name>        设备名称（默认: 主机名）
  -p, --path <path>          本地克隆路径（默认: ~/.ccmerge/repo）
  --i-know-what-im-doing     允许使用公开仓库（危险）

push / sync:
  --sessions-only            只同步 sessions
  --skills-only              只同步 skills
  --skip-scan                跳过 Secret 扫描（不推荐）

pull:
  --sessions-only            只拉取 sessions
  --skills-only              只拉取 skills
```

---

## 安全

### 私有仓库要求

Session 日志包含**完整对话历史** —— 代码、提示词、工具输出。同步仓库**必须是私有的**。

`ccmerge init` 时：
- 如果 `gh` CLI 可用，自动检查仓库可见性
- **公开仓库** → 拒绝。必须传 `--i-know-what-im-doing` 才能继续
- **无法确认**（gh 不可用） → 强提示

### Push 前 Secret 扫描

每次 `ccmerge push` 和 `ccmerge sync` 都会在提交前运行 Secret 扫描。只扫描变更/新增文件（不扫描整个仓库）。

检测模式：
| 模式 | 示例前缀 |
|---|---|
| AWS Access Key | `AKIA...` |
| AWS Secret Key | `aws_secret_access_key = ...` |
| GitHub Token | `ghp_...` |
| GitHub PAT | `github_pat_...` |
| OpenAI API Key | `sk-...` |
| Google API Key | `AIza...` |
| Slack Token | `xox[bpras]-...` |
| SSH 私钥 | `-----BEGIN ... PRIVATE KEY-----` |
| 通用 Secret | `password="..."`、`api_key='...'` |

发现 Secret 时：
- Push **被阻止**
- 输出：文件路径、行号、模式类型、脱敏片段（不会完整打印 secret 原文）

处理方式：
1. 删除 secret 后重试
2. 添加到 `.ccmerge-ignore-secrets`（见下文）
3. 使用 `--skip-scan` 强制跳过（打印强提示）

### `.ccmerge-ignore-secrets`

放在同步仓库根目录。每行一条规则：

```
# 忽略特定文件路径
path:devices/old/test-data.json

# 忽略特定检测模式
rule:generic-secret
```

### 增强的 `.gitignore`

`ccmerge init` 自动在同步仓库的 `.gitignore` 中添加：

```
.env, .env.*, .env.local, .env.*.local
*.pem, *.key, *.p12, *.pfx
id_rsa*, id_ed25519*, id_ecdsa*
credentials.json, token.json, service-account*.json
```

### 风险说明

ccmerge 通过私有 GitHub 仓库同步会话数据。请理解以下含义：
- 有仓库访问权的人可以看到你的完整对话历史
- GitHub 在其服务器上存储数据（受 GitHub 服务条款约束）
- 如果仓库变成公开的（意外或其他原因），所有历史都会暴露
- git-lfs 用于 `.jsonl` 文件，但仓库协作者仍可访问

---

## 同步内容

### Sessions（按设备隔离，无冲突）

- JSONL 文件通过 git-lfs 追踪（控制仓库体积）
- 每台设备写自己的目录 —— UUID 天然不冲突
- Manifest 记录 mtime 实现增量同步

### Skills（共享，双工具通用）

- **自定义 skills**：文件同步到 `repo/skills/`，然后 symlink 到：
  - `~/.claude/skills/{name}`（Claude Code）
  - `~/.openclaw/skills/{name}`（OpenClaw，自动检测）
- **三方 skills**：只同步 `skill-lock.json`。另一台设备执行 `claude skill install` 即可安装。

### OpenClaw 兼容

Skills 使用 `SKILL.md` + YAML frontmatter，Claude Code 和 OpenClaw 都兼容。OpenClaw 专属元数据放在 frontmatter 中，Claude Code 会忽略。

---

## 自动同步设置

ccmerge 不作为守护进程运行。用系统工具自动化：

### Git hook（post-commit）

```bash
# 在项目仓库的 .git/hooks/post-commit 中：
#!/bin/sh
ccmerge sync 2>/dev/null &
```

> 如果你明确要跳过 Secret 扫描（不推荐）：
> `ccmerge sync --skip-scan 2>/dev/null &`

### Cron（每 30 分钟）

```bash
# crontab -e
*/30 * * * * /usr/local/bin/ccmerge sync 2>&1 >> ~/.ccmerge/sync.log
```

### macOS launchd

```xml
<!-- ~/Library/LaunchAgents/com.ccmerge.sync.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ccmerge.sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/ccmerge</string>
    <string>sync</string>
  </array>
  <key>StartInterval</key>
  <integer>1800</integer>
  <key>StandardOutPath</key>
  <string>/tmp/ccmerge-sync.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/ccmerge-sync.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.ccmerge.sync.plist
```

---

## 常见问题

**Q: 能用公开仓库吗？**
A: 强烈不建议。Session 日志包含完整对话历史。`ccmerge init` 默认阻止公开仓库 —— 必须传 `--i-know-what-im-doing` 才能覆盖。

**Q: Secret 扫描误报怎么办？**
A: 在 `.ccmerge-ignore-secrets` 中添加。用 `rule:<模式ID>` 禁用特定检测模式，或 `path:<文件路径>` 跳过特定文件。

**Q: ccmerge 会读取或修改我的 Claude Code 对话吗？**
A: 不会。ccmerge 原样复制 `.jsonl` 文件。从不解析、修改或删除对话内容。

**Q: 两台设备能同时 push 吗？**
A: 可以。每台设备写入 `devices/{设备名}/`。UUID 的 session ID 意味着零冲突风险。Git 处理剩下的。

**Q: 仓库会有多大？**
A: JSONL 文件通过 git-lfs 追踪，保持 git 历史精简。实际存储取决于 GitHub 的 LFS 配额（免费层：1 GB 存储，1 GB/月带宽）。

**Q: ccmerge 能用非 GitHub 的远端吗？**
A: 应该可以。`gh` CLI 集成（仓库可见性检查）是 GitHub 专属的，但可选。

**Q: 如果仓库丢了怎么办？**
A: `~/.claude/projects/` 中的本地数据不受影响。重新创建仓库然后 push 即可。

---

## License

MIT
