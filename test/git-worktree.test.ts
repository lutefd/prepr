import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureLocalExclude, resolveRepoRoot } from "../src/core/git.js";
import { execFileText } from "../src/core/process.js";

test("configures local exclusion when prepr runs from a linked worktree", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prepr-linked-"));
  const repo = path.join(root, "repo");
  const linked = path.join(root, "linked");
  await fs.mkdir(repo);
  await execFileText("git", ["init"], { cwd: repo });
  await execFileText("git", ["config", "user.email", "prepr@example.com"], { cwd: repo });
  await execFileText("git", ["config", "user.name", "prepr"], { cwd: repo });
  await execFileText("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
  await fs.writeFile(path.join(repo, "README.md"), "prepr\n");
  await execFileText("git", ["add", "README.md"], { cwd: repo });
  await execFileText("git", ["commit", "-m", "initial"], { cwd: repo });
  await execFileText("git", ["worktree", "add", "--detach", linked, "HEAD"], { cwd: repo });

  const linkedRoot = await resolveRepoRoot(linked);
  await ensureLocalExclude(linkedRoot);
  const excludePath = (await execFileText("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: linked })).stdout.trim();
  assert.match(await fs.readFile(excludePath, "utf8"), /^\.prepr\/$/m);

  await execFileText("git", ["worktree", "remove", "--force", linked], { cwd: repo });
});
