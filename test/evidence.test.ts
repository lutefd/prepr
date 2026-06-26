import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseDiff } from "../src/core/diff.js";
import { evidenceErrors } from "../src/core/evidence.js";
import { execFileText } from "../src/core/process.js";

test("resolves diff, Git file, and configured-check evidence", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "prepr-evidence-"));
  await execFileText("git", ["init"], { cwd: repo });
  await execFileText("git", ["config", "user.email", "prepr@example.com"], { cwd: repo });
  await execFileText("git", ["config", "user.name", "prepr"], { cwd: repo });
  await execFileText("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
  await fs.writeFile(path.join(repo, "app.ts"), "export const value = 1;\n");
  await execFileText("git", ["add", "app.ts"], { cwd: repo });
  await execFileText("git", ["commit", "-m", "base"], { cwd: repo });
  const baseSha = (await execFileText("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
  await fs.writeFile(path.join(repo, "app.ts"), "export const value = 2;\n");
  await execFileText("git", ["commit", "-am", "head"], { cwd: repo });
  const headSha = (await execFileText("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
  const patch = (await execFileText("git", ["diff", "--unified=3", `${baseSha}..${headSha}`], { cwd: repo })).stdout;
  const context = {
    repoRoot: repo,
    baseSha,
    headSha,
    diff: parseDiff(patch),
    checks: [{ id: "test", command: ["npm", "test"], status: "passed" as const, durationMs: 1, stdout: "", stderr: "", truncated: false }],
    agentLog: "command-123 ran rg"
  };

  assert.deepEqual(
    await evidenceErrors(
      [
        { kind: "diff", explanation: "Changed line", file: "app.ts", lineStart: 1 },
        { kind: "base_file", explanation: "Old value", file: "app.ts", lineStart: 1 },
        { kind: "head_file", explanation: "New value", file: "app.ts", lineStart: 1 },
        { kind: "check", explanation: "Tests passed", checkId: "test" },
        { kind: "command", explanation: "Caller search", commandId: "command-123" }
      ],
      context
    ),
    []
  );
});

test("reports evidence references that cannot be resolved", async () => {
  const errors = await evidenceErrors(
    [
      { kind: "diff", explanation: "Missing line", file: "missing.ts", lineStart: 999 },
      { kind: "check", explanation: "Unknown check", checkId: "missing" },
      { kind: "command", explanation: "Unknown command", commandId: "missing-command" }
    ],
    { repoRoot: "/unused", baseSha: "base", headSha: "head", diff: [], checks: [], agentLog: "" }
  );
  assert.equal(errors.length, 3);
  assert.match(errors[0], /outside the diff/);
  assert.match(errors[1], /unknown check/);
  assert.match(errors[2], /unlogged command/);
});
