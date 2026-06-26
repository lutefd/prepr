import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCodexProcess } from "../src/agents/codex.js";
import { parseScanResponse, scanJsonSchema } from "../src/core/schema.js";

test("passes a strict schema to Codex and reads the final-message file", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "prepr-codex-"));
  const executable = path.join(workspace, "fake-codex.mjs");
  const output = {
    schemaVersion: 1,
    summary: "clean scan",
    candidates: [],
    coverage: { reviewedFiles: [], reviewedHunks: 0, exploredSymbols: [], checks: [], skippedContext: [], notes: [] }
  };
  await fs.writeFile(
    executable,
    `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
const schemaFile = args[args.indexOf("--output-schema") + 1];
const outputFile = args[args.indexOf("--output-last-message") + 1];
JSON.parse(fs.readFileSync(schemaFile, "utf8"));
fs.writeFileSync(outputFile, ${JSON.stringify(JSON.stringify(output))});
console.log(JSON.stringify({ type: "turn.completed" }));
`
  );
  await fs.chmod(executable, 0o755);

  const result = await runCodexProcess("review this", 10_000, workspace, parseScanResponse, scanJsonSchema, "scan", executable);
  assert.equal(result.output.summary, "clean scan");
  assert.equal(result.raw, JSON.stringify(output));
  assert.match(result.log, /turn.completed/);
  await assert.rejects(() => fs.stat(path.join(workspace, ".prepr-scan-schema.json")), /ENOENT/);
  await assert.rejects(() => fs.stat(path.join(workspace, ".prepr-scan-output.json")), /ENOENT/);
});
