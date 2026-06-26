import path from "node:path";
import type { FindingCategory, ReviewFinding, ReviewRun } from "../shared/types.js";
import type { AgentRunner } from "../agents/runner.js";
import { buildBundle } from "./bundle.js";
import { parseDiff } from "./diff.js";
import { writeExports } from "./export.js";
import { ensureLocalExclude, rawDiff, requireCleanTree, resolveRefs, resolveRepoRoot } from "./git.js";
import { normalizeFindings, reconcileFindings } from "./schema.js";
import { createRunDir, readDismissedFingerprints, runId, saveRun } from "./storage.js";

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
  const { bundle, supplemental } = await buildBundle({
    repoRoot,
    baseRef: options.baseRef,
    headRef: options.headRef,
    mergeBaseSha: refs.mergeBaseSha,
    headSha: refs.headSha,
    patch,
    diff,
    risk: options.risk,
    only: options.only
  });
  const dismissed = await readDismissedFingerprints(repoRoot);
  const fixed = new Set((options.previous ?? []).filter((f) => f.status === "fixed").map((f) => f.fingerprint));
  const agentResult = options.runner
    ? await options.runner.run(bundle)
    : { summary: "Agent disabled. Review bundle generated for inspection.", findings: [], raw: JSON.stringify({ summary: "Agent disabled.", findings: [] }), log: "" };
  const candidates = options.only?.length ? agentResult.findings.filter((f) => options.only?.includes(f.category)) : agentResult.findings;
  let findings = normalizeFindings(candidates, diff, {
    agent: options.agentName === "codex" ? "codex" : "none",
    createdAt,
    dismissedFingerprints: dismissed,
    fixedFingerprints: fixed
  });
  if (options.previous) {
    findings = reconcileFindings(options.previous, findings, dismissed);
  }
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
  const run: ReviewRun = {
    metadata,
    diff,
    findings,
    summary: agentResult.summary,
    uiState: {}
  };
  await saveRun(paths, run, {
    "patch.diff": patch,
    "bundle.md": bundle,
    "supplemental-context.json": supplemental,
    "findings.raw.json": agentResult.raw,
    "agent.log": agentResult.log,
    "logs.json": { createdAt, agent: options.agentName }
  });
  await writeExports(paths.runDir, run);
  return { run, runDir: paths.runDir };
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
