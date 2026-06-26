import type { CheckResult, DiffFile, EvidenceRef } from "../shared/types.js";
import { findDiffFile } from "./diff.js";
import { showFileAtRef } from "./git.js";

export interface EvidenceContext {
  repoRoot: string;
  baseSha: string;
  headSha: string;
  diff: DiffFile[];
  checks: CheckResult[];
  agentLog: string;
}

export async function evidenceErrors(evidence: EvidenceRef[], context: EvidenceContext): Promise<string[]> {
  const errors: string[] = [];
  const fileCache = new Map<string, string | undefined>();
  for (const [index, reference] of evidence.entries()) {
    const prefix = `evidence[${index}]`;
    if (reference.lineEnd !== undefined && reference.lineStart !== undefined && reference.lineEnd < reference.lineStart) {
      errors.push(`${prefix} lineEnd precedes lineStart`);
      continue;
    }
    if (reference.kind === "diff") {
      validateDiffReference(reference, context.diff, prefix, errors);
      continue;
    }
    if (reference.kind === "base_file" || reference.kind === "head_file") {
      await validateFileReference(reference, context, fileCache, prefix, errors);
      continue;
    }
    if (reference.kind === "check") {
      if (!reference.checkId) errors.push(`${prefix} is missing checkId`);
      else if (!context.checks.some((check) => check.id === reference.checkId)) errors.push(`${prefix} references unknown check ${reference.checkId}`);
      continue;
    }
    if (!reference.commandId) errors.push(`${prefix} is missing commandId`);
    else if (!context.agentLog.includes(reference.commandId)) errors.push(`${prefix} references an unlogged command ${reference.commandId}`);
  }
  return errors;
}

function validateDiffReference(reference: EvidenceRef, diff: DiffFile[], prefix: string, errors: string[]): void {
  if (!reference.file) {
    errors.push(`${prefix} is missing file`);
    return;
  }
  if (!reference.lineStart) {
    errors.push(`${prefix} is missing lineStart`);
    return;
  }
  const file = findDiffFile(diff, reference.file);
  if (!file) {
    errors.push(`${prefix} references a file outside the diff: ${reference.file}`);
    return;
  }
  const side = reference.side ?? "head";
  const containsLine = file.hunks.some((hunk) => hunk.lines.some((line) => (side === "base" ? line.oldLine : line.newLine) === reference.lineStart));
  if (!containsLine) errors.push(`${prefix} references ${side} line ${reference.lineStart} outside rendered diff context`);
}

async function validateFileReference(
  reference: EvidenceRef,
  context: EvidenceContext,
  cache: Map<string, string | undefined>,
  prefix: string,
  errors: string[]
): Promise<void> {
  if (!reference.file) {
    errors.push(`${prefix} is missing file`);
    return;
  }
  if (!reference.lineStart) {
    errors.push(`${prefix} is missing lineStart`);
    return;
  }
  const ref = reference.kind === "base_file" ? context.baseSha : context.headSha;
  const key = `${ref}:${reference.file}`;
  let content = cache.get(key);
  if (!cache.has(key)) {
    content = await showFileAtRef(context.repoRoot, ref, reference.file);
    cache.set(key, content);
  }
  if (content === undefined) {
    errors.push(`${prefix} references a file absent at ${reference.kind === "base_file" ? "base" : "head"}: ${reference.file}`);
    return;
  }
  const lines = content === "" ? [] : content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const lineCount = lines.length;
  const end = reference.lineEnd ?? reference.lineStart;
  if (reference.lineStart > lineCount || end > lineCount) errors.push(`${prefix} references lines outside ${reference.file} (${lineCount} lines)`);
}
