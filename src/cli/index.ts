#!/usr/bin/env node
import { spawn } from "node:child_process";
import { CodexRunner } from "../agents/codex.js";
import { PreprError } from "../core/errors.js";
import { parseCategories, parseRisk } from "../core/options.js";
import { createReviewRun } from "../core/run.js";
import { resolveRepoRoot } from "../core/git.js";
import { loadRun } from "../core/storage.js";
import { startServer } from "../server/http.js";

interface CliOptions {
  command?: "open";
  runId?: string;
  base?: string;
  head: string;
  agent: "codex";
  risk: "low" | "medium" | "high";
  only?: ReturnType<typeof parseCategories>;
  noAgent: boolean;
  open: boolean;
  json: boolean;
  port?: number;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "open") {
    const repoRoot = await resolveRepoRoot();
    await loadRun(repoRoot, options.runId);
    const { url } = await startServer({ repoRoot, runId: options.runId, port: options.port });
    console.log(`prepr listening at ${url}`);
    await openBrowser(url);
    return;
  }
  if (!options.base) throw new PreprError("Missing required --base <ref>.", "INVALID_OPTION");
  const runner = options.noAgent ? undefined : new CodexRunner();
  const { run } = await createReviewRun({
    baseRef: options.base,
    headRef: options.head,
    risk: options.risk,
    only: options.only,
    agentName: options.noAgent ? "none" : options.agent,
    runner
  });
  if (options.json) {
    console.log(JSON.stringify({ run: run.metadata, counts: run.metadata.counts }, null, 2));
    return;
  }
  const { url } = await startServer({
    repoRoot: run.metadata.repoRoot,
    runId: run.metadata.id,
    baseRef: run.metadata.baseRef,
    risk: run.metadata.risk,
    only: run.metadata.only,
    noAgent: options.noAgent,
    port: options.port
  });
  console.log(`prepr listening at ${url}`);
  if (options.open) await openBrowser(url);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { head: "HEAD", agent: "codex", risk: "medium", noAgent: false, open: true, json: false };
  if (args[0] === "open") {
    options.command = "open";
    options.runId = args[1]?.startsWith("--") ? undefined : args[1];
  }
  for (let i = options.command ? (options.runId ? 2 : 1) : 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => {
      const value = args[++i];
      if (!value) throw new PreprError(`${arg} requires a value.`, "INVALID_OPTION");
      return value;
    };
    if (arg === "--base") options.base = next();
    else if (arg === "--head") options.head = next();
    else if (arg === "--agent") {
      const value = next();
      if (value !== "codex") throw new PreprError("Only --agent codex is supported in v1.", "INVALID_OPTION");
      options.agent = value;
    } else if (arg === "--risk") options.risk = parseRisk(next());
    else if (arg === "--only") options.only = parseCategories(next());
    else if (arg === "--no-agent") options.noAgent = true;
    else if (arg === "--open") options.open = true;
    else if (arg === "--no-open") options.open = false;
    else if (arg === "--json") {
      options.json = true;
      options.open = false;
    } else if (arg === "--port") options.port = Number(next());
    else throw new PreprError(`Unknown argument ${arg}.`, "INVALID_OPTION");
  }
  return options;
}

async function openBrowser(url: string): Promise<void> {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof PreprError ? 2 : 1;
});
