import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentRunner } from "../src/agents/runner.js";
import { createReviewRun } from "../src/core/run.js";
import { execFileText } from "../src/core/process.js";
import { PreprError } from "../src/core/errors.js";
import type { CoverageReceipt } from "../src/shared/types.js";

const coverage: CoverageReceipt = {
  reviewedFiles: ["app.ts"],
  reviewedHunks: 1,
  exploredSymbols: [],
  checks: [],
  skippedContext: [],
  notes: []
};

test("checkpoints a completed scan when verification fails", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "prepr-checkpoint-"));
  await execFileText("git", ["init"], { cwd: repo });
  await execFileText("git", ["config", "user.email", "prepr@example.com"], { cwd: repo });
  await execFileText("git", ["config", "user.name", "prepr"], { cwd: repo });
  await execFileText("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
  await fs.writeFile(path.join(repo, "app.ts"), "export const value = 1;\n");
  await execFileText("git", ["add", "app.ts"], { cwd: repo });
  await execFileText("git", ["commit", "-m", "base"], { cwd: repo });
  const baseRef = (await execFileText("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo })).stdout.trim();
  await execFileText("git", ["checkout", "-b", "feature"], { cwd: repo });
  await fs.writeFile(path.join(repo, "app.ts"), "export const value = 2;\n");
  await execFileText("git", ["commit", "-am", "feature"], { cwd: repo });

  const runner: AgentRunner = {
    async runScan() {
      const output = { schemaVersion: 1 as const, summary: "scan completed", candidates: [], coverage };
      return { output, raw: JSON.stringify(output), log: "scan trace" };
    },
    async runVerification() {
      throw new PreprError("verifier unavailable", "AGENT_FAILED", { stdout: "verification event", stderr: "authentication failed" });
    }
  };
  await assert.rejects(
    () => createReviewRun({ cwd: repo, baseRef, headRef: "HEAD", risk: "medium", agentName: "codex", runner }),
    /verifier unavailable/
  );

  const runsDir = path.join(repo, ".prepr", "runs");
  const [runId] = await fs.readdir(runsDir);
  const runDir = path.join(runsDir, runId);
  assert.equal(JSON.parse(await fs.readFile(path.join(runDir, "scan-output.json"), "utf8")).summary, "scan completed");
  assert.equal(await fs.readFile(path.join(runDir, "scan-agent.log"), "utf8"), "scan trace");
  assert.equal(JSON.parse(await fs.readFile(path.join(runDir, "run-state.json"), "utf8")).status, "failed");
  assert.match(await fs.readFile(path.join(runDir, "agent.log"), "utf8"), /authentication failed/);
  const events = (await fs.readFile(path.join(runDir, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.status), ["preflight", "checking", "scanning", "verifying", "failed"]);
});
