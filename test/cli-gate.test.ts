import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execFileText } from "../src/core/process.js";
import type { CheckConfig } from "../src/shared/types.js";

const cliEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli/index.ts");
const tsxLoader = import.meta.resolve("tsx");

async function createTempRepo(checks: CheckConfig[]): Promise<{ repo: string; baseRef: string }> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "prepr-cli-gate-"));
  await execFileText("git", ["init"], { cwd: repo });
  await execFileText("git", ["config", "user.email", "prepr@example.com"], { cwd: repo });
  await execFileText("git", ["config", "user.name", "prepr"], { cwd: repo });
  await execFileText("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
  await fs.writeFile(path.join(repo, "app.ts"), "export const value = 1;\n");
  await execFileText("git", ["add", "app.ts"], { cwd: repo });
  await execFileText("git", ["commit", "-m", "initial"], { cwd: repo });
  const baseRef = (await execFileText("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo })).stdout.trim();
  await execFileText("git", ["checkout", "-b", "feature"], { cwd: repo });
  await fs.writeFile(path.join(repo, "app.ts"), "export const value = 2;\n");
  await execFileText("git", ["commit", "-am", "change value"], { cwd: repo });
  await fs.mkdir(path.join(repo, ".prepr"), { recursive: true });
  await fs.writeFile(path.join(repo, ".prepr", "config.json"), JSON.stringify({ schemaVersion: 1, checks }));
  return { repo, baseRef };
}

function runCli(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", tsxLoader, cliEntry, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("exits 0 and reports completed status in JSON when all configured checks pass", async () => {
  const { repo, baseRef } = await createTempRepo([
    { id: "lint", command: process.execPath, args: ["-e", "console.log('ok')"] }
  ]);

  const result = await runCli(["--base", baseRef, "--no-agent", "--json"], repo);
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "completed");
  assert.equal(payload.checks.total, 1);
  assert.equal(payload.checks.passed, 1);
  assert.equal(payload.checks.failed, 0);
  assert.deepEqual(payload.checks.failedIds, []);
  assert.equal(payload.checks.results.length, 1);
  assert.equal(payload.checks.results[0].id, "lint");
  assert.equal(payload.checks.results[0].status, "passed");
  assert.equal(payload.checks.results[0].exitCode, 0);
});

test("exits 1 and reports completed_with_check_failures in JSON when a configured check fails", async () => {
  const { repo, baseRef } = await createTempRepo([
    { id: "lint", command: process.execPath, args: ["-e", "console.log('ok')"] },
    { id: "unit-tests", command: process.execPath, args: ["-e", "console.error('boom'); process.exit(3)"] }
  ]);

  const result = await runCli(["--base", baseRef, "--no-agent", "--json"], repo);
  assert.equal(result.code, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "completed_with_check_failures");
  assert.equal(payload.checks.total, 2);
  assert.equal(payload.checks.passed, 1);
  assert.equal(payload.checks.failed, 1);
  assert.deepEqual(payload.checks.failedIds, ["unit-tests"]);
  assert.equal(payload.checks.path, path.join(payload.runDir, "checks.json"));
  assert.equal(payload.checks.results[0].status, "passed");
  assert.equal(payload.checks.results[1].id, "unit-tests");
  assert.equal(payload.checks.results[1].status, "failed");
  assert.equal(payload.checks.results[1].exitCode, 3);
  const savedState = JSON.parse(await fs.readFile(path.join(payload.runDir, "run-state.json"), "utf8"));
  assert.equal(savedState.status, "completed_with_check_failures");
});

test("exits 1 and reports completed_with_check_failures when a configured check times out or errors", async () => {
  const { repo, baseRef } = await createTempRepo([
    { id: "slow", command: process.execPath, args: ["-e", "setTimeout(() => {}, 5000)"], timeoutMs: 50 },
    { id: "missing-bin", command: "prepr-nonexistent-binary-xyz" }
  ]);

  const result = await runCli(["--base", baseRef, "--no-agent", "--json"], repo);
  assert.equal(result.code, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "completed_with_check_failures");
  assert.equal(payload.checks.total, 2);
  assert.equal(payload.checks.passed, 0);
  assert.equal(payload.checks.failed, 2);
  assert.deepEqual(payload.checks.failedIds, ["slow", "missing-bin"]);
  assert.equal(payload.checks.results[0].status, "timed_out");
  assert.equal(payload.checks.results[1].status, "error");
});
