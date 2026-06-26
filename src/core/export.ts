import path from "node:path";
import type { ReviewFinding, ReviewRun } from "../shared/types.js";
import { writeAtomic, writeJson } from "./storage.js";

export async function writeExports(runDir: string, run: ReviewRun): Promise<Record<string, string>> {
  const exportsDir = path.join(runDir, "exports");
  const summary = renderSummary(run);
  const comments = renderGithubComments(run.findings);
  const findingsFile = path.join(exportsDir, "findings.json");
  await Promise.all([
    writeAtomic(path.join(exportsDir, "review-summary.md"), summary),
    writeAtomic(path.join(exportsDir, "github-comments.md"), comments),
    writeJson(findingsFile, run.findings)
  ]);
  return {
    "review-summary.md": path.join(exportsDir, "review-summary.md"),
    "github-comments.md": path.join(exportsDir, "github-comments.md"),
    "findings.json": findingsFile
  };
}

function renderSummary(run: ReviewRun): string {
  const open = run.findings.filter((f) => f.status === "open");
  return [
    `# prepr review ${run.metadata.id}`,
    "",
    `Base: ${run.metadata.baseRef} (${run.metadata.baseSha.slice(0, 8)})`,
    `Head: ${run.metadata.headRef} (${run.metadata.headSha.slice(0, 8)})`,
    "",
    run.summary,
    "",
    `## Open findings (${open.length})`,
    ...open.map((f) => `- [${f.severity}/${f.category}] ${f.location.file}${f.location.line ? `:${f.location.line}` : ""} - ${f.title}: ${f.claim}`)
  ].join("\n");
}

function renderGithubComments(findings: ReviewFinding[]): string {
  return findings
    .filter((f) => f.status === "open")
    .map((f) => [
      `### ${f.location.file}${f.location.line ? `:${f.location.line}` : ""}`,
      "",
      `**${f.severity}/${f.category}/${f.confidence}** ${f.title}`,
      "",
      f.claim,
      f.suggestion ? `\nSuggestion: ${f.suggestion}` : ""
    ].join("\n"))
    .join("\n\n---\n\n");
}
