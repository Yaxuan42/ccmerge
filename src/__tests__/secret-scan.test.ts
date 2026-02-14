import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SECRET_PATTERNS, scanFiles, redact, loadIgnoreRules } from "../secret-scan.js";

const TMP = join(tmpdir(), "ccmerge-test-" + Date.now());

function setup() {
  mkdirSync(TMP, { recursive: true });
}

function cleanup() {
  rmSync(TMP, { recursive: true, force: true });
}

// --- Pattern tests ---

describe("SECRET_PATTERNS", () => {
  it("detects AWS Access Key ID", () => {
    const p = SECRET_PATTERNS.find((p) => p.id === "aws-access-key")!;
    assert.ok(p.regex.test("AKIAIOSFODNN7EXAMPLE"));
    assert.ok(!p.regex.test("AKIA_short"));
  });

  it("detects AWS Secret Access Key", () => {
    const p = SECRET_PATTERNS.find((p) => p.id === "aws-secret-key")!;
    assert.ok(p.regex.test('aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEYaa"'));
    assert.ok(p.regex.test("secret_key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
  });

  it("detects GitHub token (ghp_)", () => {
    const p = SECRET_PATTERNS.find((p) => p.id === "github-token")!;
    assert.ok(p.regex.test("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"));
    assert.ok(!p.regex.test("ghp_short"));
  });

  it("detects GitHub PAT (github_pat_)", () => {
    const p = SECRET_PATTERNS.find((p) => p.id === "github-pat")!;
    assert.ok(p.regex.test("github_pat_ABCDEFGHIJKLMNOPQRSTUV"));
    assert.ok(!p.regex.test("github_pat_short"));
  });

  it("detects OpenAI key (sk-)", () => {
    const p = SECRET_PATTERNS.find((p) => p.id === "openai-key")!;
    assert.ok(p.regex.test("sk-ABCDEFGHIJKLMNOPQRST1234"));
    assert.ok(!p.regex.test("sk-short"));
  });

  it("detects Google API key (AIza)", () => {
    const p = SECRET_PATTERNS.find((p) => p.id === "google-api-key")!;
    assert.ok(p.regex.test("AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"));
    assert.ok(!p.regex.test("AIzaShort"));
  });

  it("detects Slack token (xox)", () => {
    const p = SECRET_PATTERNS.find((p) => p.id === "slack-token")!;
    assert.ok(p.regex.test("xoxb-123456789-abcdefgh"));
    assert.ok(p.regex.test("xoxp-something-here"));
  });

  it("detects SSH private key header", () => {
    const p = SECRET_PATTERNS.find((p) => p.id === "ssh-private-key")!;
    assert.ok(p.regex.test("-----BEGIN OPENSSH PRIVATE KEY-----"));
    assert.ok(p.regex.test("-----BEGIN RSA PRIVATE KEY-----"));
    assert.ok(!p.regex.test("-----BEGIN PUBLIC KEY-----"));
  });

  it("detects generic secret assignments", () => {
    const p = SECRET_PATTERNS.find((p) => p.id === "generic-secret")!;
    assert.ok(p.regex.test('password="mysecretpassword123"'));
    assert.ok(p.regex.test("api_key='longapikey12345678'"));
    assert.ok(!p.regex.test('password=""'));
  });
});

// --- Redaction ---

describe("redact", () => {
  it("redacts long values", () => {
    assert.equal(redact("AKIAIOSFODNN7EXAMPLE"), "AKIA***LE");
  });

  it("fully redacts short values", () => {
    assert.equal(redact("short"), "***");
    assert.equal(redact("12345678"), "***");
  });
});

// --- File scanning ---

describe("scanFiles", () => {
  it("finds secrets in files", () => {
    setup();
    try {
      const file = join(TMP, "test.env");
      writeFileSync(file, 'AWS_KEY=AKIAIOSFODNN7EXAMPLE\nSafe line\n');

      const result = scanFiles([file], TMP);
      assert.equal(result.filesScanned, 1);
      assert.ok(result.findings.length >= 1);
      assert.equal(result.findings[0].patternId, "aws-access-key");
      assert.equal(result.findings[0].line, 1);
      // Ensure the full secret is NOT in the snippet
      assert.ok(!result.findings[0].snippet.includes("AKIAIOSFODNN7EXAMPLE"));
    } finally {
      cleanup();
    }
  });

  it("returns empty for clean files", () => {
    setup();
    try {
      const file = join(TMP, "clean.txt");
      writeFileSync(file, "This is a clean file\nNo secrets here\n");

      const result = scanFiles([file], TMP);
      assert.equal(result.filesScanned, 1);
      assert.equal(result.findings.length, 0);
    } finally {
      cleanup();
    }
  });
});

// --- Ignore rules ---

describe("loadIgnoreRules", () => {
  it("parses ignore file", () => {
    setup();
    try {
      writeFileSync(join(TMP, ".ccmerge-ignore-secrets"), [
        "# Comment",
        "path:devices/old/secrets.json",
        "rule:generic-secret",
        "",
      ].join("\n"));

      const rules = loadIgnoreRules(TMP);
      assert.deepEqual(rules.paths, ["devices/old/secrets.json"]);
      assert.deepEqual(rules.patterns, ["generic-secret"]);
    } finally {
      cleanup();
    }
  });

  it("returns empty for missing file", () => {
    const rules = loadIgnoreRules("/nonexistent");
    assert.deepEqual(rules.paths, []);
    assert.deepEqual(rules.patterns, []);
  });

  it("respects path ignore", () => {
    setup();
    try {
      writeFileSync(join(TMP, ".ccmerge-ignore-secrets"), "path:safe/\n");
      mkdirSync(join(TMP, "safe"), { recursive: true });
      const file = join(TMP, "safe", "test.env");
      writeFileSync(file, "AWS_KEY=AKIAIOSFODNN7EXAMPLE\n");

      const result = scanFiles([file], TMP);
      assert.equal(result.findings.length, 0);
    } finally {
      cleanup();
    }
  });

  it("respects rule ignore", () => {
    setup();
    try {
      writeFileSync(join(TMP, ".ccmerge-ignore-secrets"), "rule:aws-access-key\n");
      const file = join(TMP, "test.env");
      writeFileSync(file, "AWS_KEY=AKIAIOSFODNN7EXAMPLE\n");

      const result = scanFiles([file], TMP);
      // Should not find AWS key, but might find generic-secret
      const awsFindings = result.findings.filter((f) => f.patternId === "aws-access-key");
      assert.equal(awsFindings.length, 0);
    } finally {
      cleanup();
    }
  });
});
