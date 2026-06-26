import fs from "node:fs/promises";
import path from "node:path";
import type { DismissalRecord, ReviewFinding, ReviewProgressEvent, ReviewRun, RunMetadata, RunState } from "../shared/types.js";
import { PreprError } from "./errors.js";

export interface RunPaths {
  preprDir: string;
  runsDir: string;
  runDir: string;
}

export function runId(createdAt: string, branch: string, headSha: string): string {
  const stamp = createdAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${stamp}-${branch}-${headSha.slice(0, 8)}`;
}

export async function createRunDir(repoRoot: string, id: string): Promise<RunPaths> {
  const preprDir = path.join(repoRoot, ".prepr");
  const runsDir = path.join(preprDir, "runs");
  const runDir = path.join(runsDir, id);
  await fs.mkdir(runsDir, { recursive: true });
  await fs.mkdir(runDir, { recursive: false });
  await fs.mkdir(path.join(runDir, "exports"));
  return { preprDir, runsDir, runDir };
}

export async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

export async function saveRun(paths: RunPaths, run: ReviewRun, artifacts: Record<string, string | unknown>): Promise<void> {
  await writeJson(path.join(paths.runDir, "metadata.json"), run.metadata);
  await writeJson(path.join(paths.runDir, "diff.json"), run.diff);
  await writeJson(path.join(paths.runDir, "findings.json"), run.findings);
  await writeAtomic(path.join(paths.runDir, "summary.md"), run.summary);
  await writeJson(path.join(paths.runDir, "ui-state.json"), run.uiState ?? {});
  for (const [name, value] of Object.entries(artifacts)) {
    const file = path.join(paths.runDir, name);
    if (typeof value === "string") await writeAtomic(file, value);
    else await writeJson(file, value);
  }
}

export async function loadRun(repoRoot: string, id?: string): Promise<ReviewRun> {
  const runDir = id ? path.join(repoRoot, ".prepr", "runs", id) : await latestRunDir(repoRoot);
  const metadata = await readJson<RunMetadata>(path.join(runDir, "metadata.json"));
  return {
    metadata,
    diff: await readJson(path.join(runDir, "diff.json")),
    findings: await readJson(path.join(runDir, "findings.json")),
    summary: await fs.readFile(path.join(runDir, "summary.md"), "utf8"),
    coverage: await readJson<ReviewRun["coverage"]>(path.join(runDir, "coverage.json")).catch(() => undefined),
    state: await readJson<RunState>(path.join(runDir, "run-state.json")).catch(() => undefined),
    uiState: (await readJson<Record<string, unknown>>(path.join(runDir, "ui-state.json")).catch(() => ({})))
  };
}

export async function writeRunState(runDir: string, state: RunState, sequence: number): Promise<void> {
  await writeJson(path.join(runDir, "run-state.json"), state);
  const event: ReviewProgressEvent = { ...state, sequence };
  await fs.appendFile(path.join(runDir, "events.jsonl"), `${JSON.stringify(event)}\n`);
}

export async function latestRunDir(repoRoot: string): Promise<string> {
  const runsDir = path.join(repoRoot, ".prepr", "runs");
  const entries = await fs.readdir(runsDir).catch(() => []);
  if (!entries.length) throw new PreprError("No prepr runs found. Run `prepr --base <ref>` first.", "NO_RUNS");
  entries.sort();
  return path.join(runsDir, entries.at(-1) as string);
}

export async function updateFindings(repoRoot: string, runIdValue: string, updater: (findings: ReviewFinding[]) => ReviewFinding[]): Promise<ReviewFinding[]> {
  const file = path.join(repoRoot, ".prepr", "runs", runIdValue, "findings.json");
  const findings = await readJson<ReviewFinding[]>(file);
  const next = updater(findings);
  await writeJson(file, next);
  return next;
}

export async function updateMetadataCounts(repoRoot: string, runIdValue: string, counts: unknown): Promise<void> {
  const file = path.join(repoRoot, ".prepr", "runs", runIdValue, "metadata.json");
  const metadata = await readJson<Record<string, unknown>>(file);
  await writeJson(file, { ...metadata, counts });
}

export async function updateUiState(repoRoot: string, runIdValue: string, state: Record<string, unknown>): Promise<void> {
  await writeJson(path.join(repoRoot, ".prepr", "runs", runIdValue, "ui-state.json"), state);
}

export async function readDismissals(repoRoot: string): Promise<DismissalRecord[]> {
  const file = path.join(repoRoot, ".prepr", "dismissals.json");
  return readJson<DismissalRecord[]>(file).catch(() => []);
}

export async function addDismissal(repoRoot: string, dismissal: DismissalRecord): Promise<void> {
  const values = await readDismissals(repoRoot);
  const next = values.filter((value) => value.fingerprint !== dismissal.fingerprint || value.regionHash !== dismissal.regionHash);
  next.push(dismissal);
  await fs.mkdir(path.join(repoRoot, ".prepr"), { recursive: true });
  await writeJson(path.join(repoRoot, ".prepr", "dismissals.json"), next.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
}
