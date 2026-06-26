import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runConfiguredChecks } from "../src/core/checks.js";
import { loadConfig } from "../src/core/config.js";

test("loads defaults when no local config exists", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "prepr-config-"));
  assert.deepEqual(await loadConfig(repo), { schemaVersion: 1, checks: [] });
});

test("rejects duplicate check identifiers", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "prepr-config-"));
  await fs.mkdir(path.join(repo, ".prepr"));
  await fs.writeFile(
    path.join(repo, ".prepr", "config.json"),
    JSON.stringify({ schemaVersion: 1, checks: [{ id: "test", command: "node" }, { id: "test", command: "node" }] })
  );
  await assert.rejects(() => loadConfig(repo), /Duplicate configured check id/);
});

test("captures configured check failures without aborting the review", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "prepr-check-"));
  const [result] = await runConfiguredChecks(
    [{ id: "failing", command: process.execPath, args: ["-e", "console.error('expected failure'); process.exit(3)"], timeoutMs: 10_000 }],
    workspace
  );
  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 3);
  assert.match(result.stderr, /expected failure/);
});
