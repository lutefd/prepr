import path from "node:path";
import type { FindingCategory, ReviewFinding, ReviewRun } from "../shared/types.js";
import type { AgentRunner } from "../agents/runner.js";
import { buildBundle } from "./bundle.js";
import { runConfiguredChecks } from "./checks.js";
import { loadConfig } from "./config.js";
import { parseDiff } from "./diff.js";
import { PreprError } from "./errors.js";
import { writeExports } from "./export.js";
import { ensureLocalExclude, rawDiff, requireCleanTree, resolveRefs, resolveRepoRoot } from "./git.js";
import { normalizeFindings, reconcileFindings } from "./schema.js";
import { createRunDir, readDismissals, runId, saveRun, writeAtomic, writeJson, writeRunState } from "./storage.js";
import { runReviewWorkflow } from "./workflow.js";
import { createReviewWorkspace, removeReviewWorkspace, restoreReviewWorkspace } from "./workspace.js";

export interface CreateRunOptions {
  cwd?: string;
  baseRef: string;
  headRef: string;
  risk: "low" | "medium" | "high";
  only?: FindingCategory[];
  agentName: "codex" | "none";
  runner?: AgentRunner;
  previous?: ReviewFinding[];
}

export async function createReviewRun(options: CreateRunOptions): Promise<{ run: ReviewRun; runDir: string }> {
  const repoRoot = await resolveRepoRoot(options.cwd);
  await requireCleanTree(repoRoot);
  await ensureLocalExclude(repoRoot);
  const refs = await resolveRefs(repoRoot, options.baseRef, options.headRef);
  const patch = await rawDiff(repoRoot, refs.mergeBaseSha, refs.headSha);
  const diff = parseDiff(patch);
  const createdAt = new Date().toISOString();
  const id = runId(createdAt, refs.branch, refs.headSha);
  const paths = await createRunDir(repoRoot, id);
  let eventSequence = 0;
  const transition = async (status: NonNullable<ReviewRun["state"]>["status"], error?: unknown) => {
    const state = {
      runId: id,
      status,
      updatedAt: new Date().toISOString(),
      error: error
        ? { code: error instanceof PreprError ? error.code : undefined, message: error instanceof Error ? error.message : String(error) }
        : undefined
    };
    await writeRunState(paths.runDir, state, ++eventSequence);
    return state;
  };
  await transition("preflight");
  let workspace: string | undefined;
  try {
    workspace = await createReviewWorkspace(repoRoot, id, refs.headSha);
    const config = await loadConfig(repoRoot);
    await transition("checking");
    const checks = await runConfiguredChecks(config.checks, workspace);
    await writeJson(path.join(paths.runDir, "checks.json"), checks);
    await restoreReviewWorkspace(workspace, refs.headSha);
    const { bundle, supplemental } = await buildBundle({
      repoRoot,
      baseRef: options.baseRef,
      headRef: options.headRef,
      mergeBaseSha: refs.mergeBaseSha,
      headSha: refs.headSha,
      patch,
      diff,
      risk: options.risk,
      only: options.only,
      checks
    });
    const dismissals = await readDismissals(repoRoot);
    const fixed = new Set((options.previous ?? []).filter((f) => f.status === "fixed").map((f) => f.fingerprint));
    const workflow = options.runner
      ? await runReviewWorkflow({
          runner: options.runner,
          bundle,
          workspace,
          previous: options.previous,
          evidenceContext: { repoRoot, baseSha: refs.mergeBaseSha, headSha: refs.headSha, diff, checks },
          onStageStart: async (stage) => {
            await transition(stage === "scan" ? "scanning" : "verifying");
          },
          onStageComplete: async (stage, result) => {
            await writeJson(path.join(paths.runDir, `${stage}-output.json`), result.output);
            await writeAtomic(path.join(paths.runDir, `${stage}-raw.json`), result.raw);
            await writeAtomic(path.join(paths.runDir, `${stage}-agent.log`), result.log);
          }
        })
      : disabledWorkflow(diff, checks.map((check) => check.id));
    const candidates = options.only?.length ? workflow.findings.filter((f) => options.only?.includes(f.category)) : workflow.findings;
    let findings = normalizeFindings(candidates, diff, {
      agent: options.agentName === "codex" ? "codex" : "none",
      createdAt,
      dismissals,
      fixedFingerprints: fixed
    });
    if (options.previous) findings = reconcileFindings(options.previous, findings, dismissals);
    const metadata = {
      id,
      repoRoot,
      branch: refs.branch,
      baseRef: options.baseRef,
      headRef: options.headRef,
      baseSha: refs.baseSha,
      headSha: refs.headSha,
      mergeBaseSha: refs.mergeBaseSha,
      createdAt,
      risk: options.risk,
      only: options.only,
      agent: options.agentName,
      counts: countFindings(diff.length, findings)
    };
    const finalStatus = checks.some((check) => check.status !== "passed") ? "completed_with_check_failures" : "completed";
    const run: ReviewRun = {
      metadata,
      diff,
      findings,
      summary: workflow.verification.summary,
      coverage: workflow.coverage,
      state: { runId: id, status: finalStatus, updatedAt: new Date().toISOString() },
      uiState: {}
    };
    await saveRun(paths, run, {
      "patch.diff": patch,
      "bundle.md": bundle,
      "supplemental-context.json": supplemental,
      "scan-output.json": workflow.scan,
      "verify-output.json": workflow.verification,
      "suppressed-findings.json": workflow.suppressed,
      "coverage.json": workflow.coverage,
      "agent.log": workflow.log,
      "logs.json": { createdAt, agent: options.agentName }
    });
    await writeExports(paths.runDir, run);
    run.state = await transition(finalStatus);
    return { run, runDir: paths.runDir };
  } catch (error) {
    await transition("failed", error);
    throw error;
  } finally {
    if (workspace) await removeReviewWorkspace(repoRoot, workspace);
  }
}

function disabledWorkflow(diff: ReviewRun["diff"], checks: string[]): Awaited<ReturnType<typeof runReviewWorkflow>> {
  const coverage = {
    reviewedFiles: diff.map((file) => file.newPath),
    reviewedHunks: diff.reduce((count, file) => count + file.hunks.length, 0),
    exploredSymbols: [],
    checks,
    skippedContext: ["Agent review disabled"],
    notes: ["Diff bundle generated without an agent scan or verification pass."]
  };
  return {
    scan: { schemaVersion: 1, summary: "Agent disabled.", candidates: [], coverage },
    verification: { schemaVersion: 1, summary: "Agent disabled. Review bundle generated for inspection.", decisions: [], coverage },
    findings: [],
    suppressed: [],
    coverage,
    log: ""
  };
}

export function countFindings(files: number, findings: ReviewFinding[]) {
  return {
    files,
    findings: findings.length,
    open: findings.filter((f) => f.status === "open").length,
    dismissed: findings.filter((f) => f.status === "dismissed").length,
    fixed: findings.filter((f) => f.status === "fixed").length,
    resolved: findings.filter((f) => f.status === "resolved").length
  };
}

export function runDirectory(repoRoot: string, id: string): string {
  return path.join(repoRoot, ".prepr", "runs", id);
}
