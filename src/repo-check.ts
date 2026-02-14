import { execSync } from "child_process";

export type RepoVisibility = "private" | "public" | "unknown";

/**
 * Check repository visibility using `gh api`.
 * Falls back to "unknown" if gh CLI is unavailable.
 */
export function checkRepoVisibility(repoUrl: string): RepoVisibility {
  const slug = extractRepoSlug(repoUrl);
  if (!slug) return "unknown";

  try {
    const output = execSync(`gh api repos/${slug} --jq .private`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    }).trim();

    if (output === "true") return "private";
    if (output === "false") return "public";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Extract "owner/repo" from various GitHub URL formats.
 */
function extractRepoSlug(url: string): string | null {
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com[/:]([^/]+\/[^/.]+)/);
  if (httpsMatch) return httpsMatch[1];

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/github\.com:([^/]+\/[^/.]+)/);
  if (sshMatch) return sshMatch[1];

  return null;
}

/**
 * Enhanced .gitignore entries for security.
 * These are added to the sync repo's .gitignore during init.
 */
export const SECURITY_GITIGNORE_ENTRIES = [
  "# Secrets & credentials",
  ".env",
  ".env.*",
  ".env.local",
  ".env.*.local",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "id_rsa*",
  "id_ed25519*",
  "id_ecdsa*",
  "credentials.json",
  "token.json",
  "service-account*.json",
  ".gcp-credentials.json",
  "",
  "# OS",
  ".DS_Store",
  "Thumbs.db",
  "",
];
