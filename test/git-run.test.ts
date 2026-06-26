import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createReviewRun } from "../src/core/run.js";
import { execFileText } from "../src/core/process.js";

test("creates a no-agent review run from a temporary git repository", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "prepr-"));
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
  await fs.writeFile(
    path.join(repo, ".prepr", "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      checks: [
        {
          id: "mutating-check",
          command: process.execPath,
          args: ["-e", "require('fs').writeFileSync('app.ts', 'check changed this file\\n'); console.log('check passed')"]
        }
      ]
    })
  );

  const { run, runDir } = await createReviewRun({
    cwd: repo,
    baseRef,
    headRef: "HEAD",
    risk: "low",
    agentName: "none"
  });

  assert.equal(run.metadata.agent, "none");
  assert.equal(run.state?.status, "completed");
  assert.equal(run.diff.length, 1);
  assert.match(runDir, /\.prepr\/runs/);
  assert.ok(await fs.readFile(path.join(repo, ".git", "info", "exclude"), "utf8").then((text) => text.includes(".prepr/")));
  assert.equal(await fs.readFile(path.join(repo, "app.ts"), "utf8"), "export const value = 2;\n");
  const checks = JSON.parse(await fs.readFile(path.join(runDir, "checks.json"), "utf8"));
  assert.equal(checks[0].status, "passed");
  assert.match(checks[0].stdout, /check passed/);
  assert.deepEqual(await fs.readdir(path.join(repo, ".prepr", "worktrees")), []);
  const events = (await fs.readFile(path.join(runDir, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.status), ["preflight", "checking", "completed"]);
});
