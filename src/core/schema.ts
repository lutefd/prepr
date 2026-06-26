import crypto from "node:crypto";
import path from "node:path";
import type {
  CoverageReceipt,
  DismissalRecord,
  DiffFile,
  EvidenceKind,
  EvidenceRef,
  FindingCandidate,
  FindingCategory,
  FindingConfidence,
  FindingSeverity,
  ReviewFinding,
  ScanResult,
  VerificationDecision,
  VerificationResult,
  VerificationVerdict
} from "../shared/types.js";
import { findDiffFile, nearestChangedNewLine } from "./diff.js";
import { PreprError } from "./errors.js";
import { validateRepoPath } from "./git.js";

export const severities = ["critical", "high", "medium", "low", "info"] as const satisfies readonly FindingSeverity[];
export const categories = ["bug", "security", "performance", "maintainability", "test", "docs", "style"] as const satisfies readonly FindingCategory[];
export const confidences = ["high", "medium", "low"] as const satisfies readonly FindingConfidence[];

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "explanation", "file", "ref", "side", "lineStart", "lineEnd", "checkId", "commandId", "excerpt"],
  properties: {
    kind: { type: "string", enum: ["diff", "base_file", "head_file", "check", "command"] },
    explanation: { type: "string" },
    file: { type: ["string", "null"] },
    ref: { type: ["string", "null"] },
    side: { type: ["string", "null"], enum: ["base", "head", null] },
    lineStart: { type: ["number", "null"] },
    lineEnd: { type: ["number", "null"] },
    checkId: { type: ["string", "null"] },
    commandId: { type: ["string", "null"] },
    excerpt: { type: ["string", "null"] }
  }
} as const;

const coverageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reviewedFiles", "reviewedHunks", "exploredSymbols", "checks", "skippedContext", "notes"],
  properties: {
    reviewedFiles: { type: "array", items: { type: "string" } },
    reviewedHunks: { type: "number" },
    exploredSymbols: { type: "array", items: { type: "string" } },
    checks: { type: "array", items: { type: "string" } },
    skippedContext: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } }
  }
} as const;

const locationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["file", "line"],
  properties: {
    file: { type: "string" },
    line: { type: ["number", "null"] }
  }
} as const;

export const scanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "summary", "candidates", "coverage"],
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    summary: { type: "string" },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "claim", "severity", "category", "confidence", "location", "impact", "trigger", "evidence", "counterEvidence", "suggestion"],
        properties: {
          title: { type: "string" },
          claim: { type: "string" },
          severity: { type: "string", enum: severities },
          category: { type: "string", enum: categories },
          confidence: { type: "string", enum: confidences },
          location: locationSchema,
          impact: { type: ["string", "null"] },
          trigger: { type: ["string", "null"] },
          evidence: { type: "array", items: evidenceSchema },
          counterEvidence: { type: ["array", "null"], items: { type: "string" } },
          suggestion: { type: ["string", "null"] }
        }
      }
    },
    coverage: coverageSchema
  }
};

export const verificationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "summary", "decisions", "coverage"],
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    summary: { type: "string" },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidateId", "verdict", "rationale", "confidence", "evidence", "severity", "category", "location", "suggestion", "relatedPreviousFindingId"],
        properties: {
          candidateId: { type: "string" },
          verdict: { type: "string", enum: ["confirmed", "rejected", "uncertain"] },
          rationale: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence: { type: "array", items: evidenceSchema },
          severity: { type: ["string", "null"], enum: [...severities, null] },
          category: { type: ["string", "null"], enum: [...categories, null] },
          location: { anyOf: [locationSchema, { type: "null" }] },
          suggestion: { type: ["string", "null"] },
          relatedPreviousFindingId: { type: ["string", "null"] }
        }
      }
    },
    coverage: coverageSchema
  }
};

export function parseScanResponse(raw: string): ScanResult {
  const parsed = parseJson(raw);
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.summary !== "string" || !Array.isArray(parsed.candidates)) {
    throw new PreprError("Scan JSON must contain { schemaVersion: 1, summary, candidates, coverage }.", "MALFORMED_AGENT_OUTPUT");
  }
  return {
    schemaVersion: 1,
    summary: parsed.summary,
    candidates: parsed.candidates.map((value, index) => ({ ...validateCandidate(value), candidateId: `candidate-${String(index + 1).padStart(3, "0")}` })),
    coverage: validateCoverage(parsed.coverage)
  };
}

export function parseVerificationResponse(raw: string): VerificationResult {
  const parsed = parseJson(raw);
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.summary !== "string" || !Array.isArray(parsed.decisions)) {
    throw new PreprError("Verification JSON must contain { schemaVersion: 1, summary, decisions, coverage }.", "MALFORMED_AGENT_OUTPUT");
  }
  return {
    schemaVersion: 1,
    summary: parsed.summary,
    decisions: parsed.decisions.map(validateVerificationDecision),
    coverage: validateCoverage(parsed.coverage)
  };
}

export function validateCandidate(value: unknown): FindingCandidate {
  if (!isRecord(value) || !isRecord(value.location)) {
    throw new PreprError("Finding candidate is malformed.", "MALFORMED_FINDING");
  }
  const candidate: FindingCandidate = {
    title: requiredString(value.title, "title"),
    claim: requiredString(value.claim, "claim"),
    severity: enumValue(value.severity, severities, "severity"),
    category: enumValue(value.category, categories, "category"),
    confidence: enumValue(value.confidence, confidences, "confidence"),
    location: {
      file: requiredString(value.location.file, "location.file"),
      line: typeof value.location.line === "number" && Number.isFinite(value.location.line) ? Math.max(1, Math.floor(value.location.line)) : undefined
    },
    impact: optionalString(value.impact),
    trigger: optionalString(value.trigger),
    evidence: validateEvidenceList(value.evidence),
    counterEvidence: optionalStringList(value.counterEvidence, "counterEvidence"),
    suggestion: typeof value.suggestion === "string" ? value.suggestion : undefined
  };
  validateRepoPath(candidate.location.file);
  candidate.location.file = normalizeCandidatePath(candidate.location.file);
  return candidate;
}

function validateVerificationDecision(value: unknown): VerificationDecision {
  if (!isRecord(value)) throw new PreprError("Verification decision is malformed.", "MALFORMED_VERIFICATION");
  const location = value.location == null ? undefined : validateLocation(value.location);
  return {
    candidateId: requiredString(value.candidateId, "candidateId"),
    verdict: enumValue(value.verdict, ["confirmed", "rejected", "uncertain"] as const satisfies readonly VerificationVerdict[], "verdict"),
    rationale: requiredString(value.rationale, "rationale"),
    confidence: boundedNumber(value.confidence, "confidence", 0, 1),
    evidence: validateEvidenceList(value.evidence),
    severity: value.severity == null ? undefined : enumValue(value.severity, severities, "severity"),
    category: value.category == null ? undefined : enumValue(value.category, categories, "category"),
    location,
    suggestion: optionalString(value.suggestion),
    relatedPreviousFindingId: optionalString(value.relatedPreviousFindingId)
  };
}

function validateLocation(value: unknown): FindingCandidate["location"] {
  if (!isRecord(value)) throw new PreprError("Finding location is malformed.", "MALFORMED_FINDING");
  const file = normalizeCandidatePath(requiredString(value.file, "location.file"));
  validateRepoPath(file);
  return {
    file,
    line: value.line == null ? undefined : Math.max(1, Math.floor(boundedNumber(value.line, "location.line", 1, Number.MAX_SAFE_INTEGER)))
  };
}

function validateEvidenceList(value: unknown): EvidenceRef[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PreprError("Every finding or decision requires at least one evidence reference.", "MALFORMED_EVIDENCE");
  }
  return value.map((entry) => {
    if (!isRecord(entry)) throw new PreprError("Evidence reference is malformed.", "MALFORMED_EVIDENCE");
    const file = optionalString(entry.file);
    if (file) validateRepoPath(file);
    return {
      kind: enumValue(entry.kind, ["diff", "base_file", "head_file", "check", "command"] as const satisfies readonly EvidenceKind[], "evidence.kind"),
      explanation: requiredString(entry.explanation, "evidence.explanation"),
      file: file ? normalizeCandidatePath(file) : undefined,
      ref: optionalString(entry.ref),
      side: entry.side == null ? undefined : enumValue(entry.side, ["base", "head"] as const, "evidence.side"),
      lineStart: optionalPositiveInteger(entry.lineStart, "evidence.lineStart"),
      lineEnd: optionalPositiveInteger(entry.lineEnd, "evidence.lineEnd"),
      checkId: optionalString(entry.checkId),
      commandId: optionalString(entry.commandId),
      excerpt: optionalString(entry.excerpt)
    };
  });
}

function validateCoverage(value: unknown): CoverageReceipt {
  if (!isRecord(value)) throw new PreprError("Coverage receipt is malformed.", "MALFORMED_COVERAGE");
  return {
    reviewedFiles: stringList(value.reviewedFiles, "coverage.reviewedFiles").map(normalizeCandidatePath),
    reviewedHunks: Math.floor(boundedNumber(value.reviewedHunks, "coverage.reviewedHunks", 0, Number.MAX_SAFE_INTEGER)),
    exploredSymbols: stringList(value.exploredSymbols, "coverage.exploredSymbols"),
    checks: stringList(value.checks, "coverage.checks"),
    skippedContext: stringList(value.skippedContext, "coverage.skippedContext"),
    notes: stringList(value.notes, "coverage.notes")
  };
}

export function normalizeFindings(
  candidates: FindingCandidate[],
  diff: DiffFile[],
  options: {
    agent: "codex" | "none";
    createdAt: string;
    dismissals: DismissalRecord[];
    fixedFingerprints?: Set<string>;
  }
): ReviewFinding[] {
  const seen = new Set<string>();
  const findings: ReviewFinding[] = [];
  for (const candidate of candidates) {
    validateRepoPath(candidate.location.file);
    candidate.location.file = normalizeCandidatePath(candidate.location.file);
    const file = findDiffFile(diff, candidate.location.file);
    if (!file) continue;
    const line = nearestChangedNewLine(file, candidate.location.line);
    const anchored: FindingCandidate = {
      ...candidate,
      location: { file: file.newPath, line }
    };
    const fingerprint = stableFingerprint(anchored);
    const regionHash = codeRegionHash(file, line);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const fixedAgain = options.fixedFingerprints?.has(fingerprint) ?? false;
    findings.push({
      ...anchored,
      id: shortHash(`${fingerprint}:${options.createdAt}`),
      agent: options.agent,
      createdAt: options.createdAt,
      fingerprint,
      regionHash,
      status: isDismissed(options.dismissals, fingerprint, regionHash) ? "dismissed" : fixedAgain ? "open" : "open",
      isNew: true
    });
  }
  return findings;
}

export function reconcileFindings(previous: ReviewFinding[], current: ReviewFinding[], dismissals: DismissalRecord[]): ReviewFinding[] {
  const currentFingerprints = new Set(current.map((f) => f.fingerprint));
  const carryResolved = previous
    .filter((f) => !currentFingerprints.has(f.fingerprint) && f.status !== "resolved")
    .map((f) => ({ ...f, status: "resolved" as const, isNew: false }));
  return [
    ...current.map((finding) => {
      const prior = previous.find((p) => p.fingerprint === finding.fingerprint);
      const status: ReviewFinding["status"] = isDismissed(dismissals, finding.fingerprint, finding.regionHash) ? "dismissed" : "open";
      return {
        ...finding,
        status,
        isNew: !prior
      };
    }),
    ...carryResolved
  ];
}

export function codeRegionHash(file: DiffFile, line?: number): string {
  const matchingHunk = line === undefined
    ? file.hunks[0]
    : file.hunks.find((hunk) => hunk.lines.some((entry) => entry.newLine === line));
  if (!matchingHunk) return shortHash(`${file.newPath}\nfile-level`);
  const index = line === undefined ? 0 : Math.max(0, matchingHunk.lines.findIndex((entry) => entry.newLine === line));
  const region = matchingHunk.lines
    .slice(Math.max(0, index - 3), index + 4)
    .map((entry) => `${entry.kind}:${entry.content}`)
    .join("\n");
  return shortHash(`${file.newPath}\n${region}`);
}

function isDismissed(dismissals: DismissalRecord[], fingerprint: string, regionHash: string): boolean {
  return dismissals.some((dismissal) => dismissal.fingerprint === fingerprint && dismissal.regionHash === regionHash);
}

export function stableFingerprint(candidate: FindingCandidate): string {
  return shortHash(
    [
      normalizeCandidatePath(candidate.location.file),
      candidate.category,
      candidate.title.trim().toLowerCase(),
      candidate.claim.trim().toLowerCase()
    ].join("\n")
  );
}

export function normalizeCandidatePath(file: string): string {
  return path.posix.normalize(file.replaceAll("\\", "/")).replace(/^\.\//, "");
}

function shortHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PreprError(`Finding field ${field} must be a non-empty string.`, "MALFORMED_FINDING");
  }
  return value.trim();
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new PreprError(`Finding field ${field} must be one of: ${allowed.join(", ")}.`, "MALFORMED_FINDING");
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new PreprError(`Agent returned malformed JSON: ${(error as Error).message}`, "MALFORMED_AGENT_OUTPUT");
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new PreprError(`${field} must be an array of strings.`, "MALFORMED_AGENT_OUTPUT");
  }
  return value.map((item) => (item as string).trim()).filter(Boolean);
}

function optionalStringList(value: unknown, field: string): string[] | undefined {
  return value == null ? undefined : stringList(value, field);
}

function boundedNumber(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new PreprError(`${field} must be a number between ${minimum} and ${maximum}.`, "MALFORMED_AGENT_OUTPUT");
  }
  return value;
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value == null) return undefined;
  return Math.floor(boundedNumber(value, field, 1, Number.MAX_SAFE_INTEGER));
}
