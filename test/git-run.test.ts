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

  const { run, runDir } = await createReviewRun({
    cwd: repo,
    baseRef,
    headRef: "HEAD",
    risk: "low",
    agentName: "none"
  });

  assert.equal(run.metadata.agent, "none");
  assert.equal(run.diff.length, 1);
  assert.match(runDir, /\.prepr\/runs/);
  assert.ok(await fs.readFile(path.join(repo, ".git", "info", "exclude"), "utf8").then((text) => text.includes(".prepr/")));
});
