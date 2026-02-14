import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, relative } from "path";

// --- Secret Pattern Definitions ---

export interface SecretPattern {
  id: string;
  label: string;
  regex: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: "aws-access-key",
    label: "AWS Access Key ID",
    regex: /\b(AKIA[0-9A-Z]{16})\b/,
  },
  {
    id: "aws-secret-key",
    label: "AWS Secret Access Key",
    regex: /(?:aws_secret_access_key|secret_key|aws_secret)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/i,
  },
  {
    id: "github-token",
    label: "GitHub Token",
    regex: /\b(ghp_[A-Za-z0-9]{36,})\b/,
  },
  {
    id: "github-pat",
    label: "GitHub Personal Access Token",
    regex: /\b(github_pat_[A-Za-z0-9_]{22,})\b/,
  },
  {
    id: "openai-key",
    label: "OpenAI API Key",
    regex: /\b(sk-[A-Za-z0-9]{20,})\b/,
  },
  {
    id: "google-api-key",
    label: "Google API Key",
    regex: /\b(AIza[A-Za-z0-9_-]{35})\b/,
  },
  {
    id: "slack-token",
    label: "Slack Token",
    regex: /\b(xox[bpras]-[A-Za-z0-9-]{10,})\b/,
  },
  {
    id: "ssh-private-key",
    label: "SSH Private Key",
    regex: /-----BEGIN (OPENSSH|RSA|DSA|EC|PGP) PRIVATE KEY-----/,
  },
  {
    id: "generic-secret",
    label: "Generic Secret Assignment",
    regex: /(?:secret|password|passwd|token|api_key|apikey|access_key)\s*[=:]\s*["']([^"'\s]{8,})["']/i,
  },
];

// --- Scan Results ---

export interface SecretFinding {
  file: string;
  line: number;
  patternId: string;
  label: string;
  /** Redacted snippet showing context but not the full secret */
  snippet: string;
}

export interface ScanResult {
  findings: SecretFinding[];
  filesScanned: number;
}

// --- Ignore Rules ---

export interface IgnoreRules {
  paths: string[];
  patterns: string[];
}

/**
 * Load .ccmerge-ignore-secrets from the repo root.
 * Format: one rule per line. Lines starting with # are comments.
 * - "path:some/file.txt" ignores a specific path
 * - "rule:aws-access-key" ignores a specific pattern ID
 */
export function loadIgnoreRules(repoPath: string): IgnoreRules {
  const ignoreFile = join(repoPath, ".ccmerge-ignore-secrets");
  const rules: IgnoreRules = { paths: [], patterns: [] };

  if (!existsSync(ignoreFile)) return rules;

  const content = readFileSync(ignoreFile, "utf-8");
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("path:")) {
      rules.paths.push(line.slice(5).trim());
    } else if (line.startsWith("rule:")) {
      rules.patterns.push(line.slice(5).trim());
    }
  }

  return rules;
}

/**
 * Redact a secret value: show first 4 chars + "***" + last 2 chars.
 * For very short values, just show "***".
 */
export function redact(value: string): string {
  if (value.length <= 8) return "***";
  return value.slice(0, 4) + "***" + value.slice(-2);
}

/**
 * Scan a single file for secrets.
 */
function scanFileContent(
  filePath: string,
  displayPath: string,
  patterns: SecretPattern[],
): SecretFinding[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return []; // Binary or unreadable file
  }

  // Skip very large files (>5MB) — likely binary or data
  if (content.length > 5 * 1024 * 1024) return [];

  const findings: SecretFinding[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      const match = pattern.regex.exec(line);
      if (!match) continue;

      // Build a redacted snippet
      const matchedText = match[1] || match[0];
      const snippet = line
        .slice(Math.max(0, match.index - 10), match.index + matchedText.length + 10)
        .replace(matchedText, redact(matchedText))
        .trim();

      findings.push({
        file: displayPath,
        line: i + 1,
        patternId: pattern.id,
        label: pattern.label,
        snippet,
      });
    }
  }

  return findings;
}

/**
 * Scan a list of files for secrets.
 *
 * @param files - Absolute paths to files to scan
 * @param repoPath - Repo root (for relative path display and ignore rules)
 */
export function scanFiles(files: string[], repoPath: string): ScanResult {
  const ignoreRules = loadIgnoreRules(repoPath);

  // Filter patterns based on ignore rules
  const activePatterns = SECRET_PATTERNS.filter(
    (p) => !ignoreRules.patterns.includes(p.id),
  );

  const allFindings: SecretFinding[] = [];
  let filesScanned = 0;

  for (const file of files) {
    const relPath = relative(repoPath, file);

    // Check if path is ignored
    if (ignoreRules.paths.some((p) => relPath.startsWith(p) || relPath === p)) {
      continue;
    }

    const findings = scanFileContent(file, relPath, activePatterns);
    allFindings.push(...findings);
    filesScanned++;
  }

  return { findings: allFindings, filesScanned };
}

/**
 * Get list of files that are staged or changed in git (new/modified).
 * This is what will be pushed — only scan these for performance.
 */
export function getChangedFiles(repoPath: string): string[] {
  try {
    // Get staged + unstaged tracked changes + untracked files
    const output = execSync(
      'git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard',
      { cwd: repoPath, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (!output) return [];
    const relPaths = [...new Set(output.split("\n").filter(Boolean))];
    return relPaths.map((p) => join(repoPath, p));
  } catch {
    // Fallback: scan all tracked files
    try {
      const output = execSync("git ls-files", {
        cwd: repoPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (!output) return [];
      return output.split("\n").filter(Boolean).map((p) => join(repoPath, p));
    } catch {
      return [];
    }
  }
}
