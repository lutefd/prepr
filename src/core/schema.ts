import crypto from "node:crypto";
import path from "node:path";
import type { DiffFile, FindingCandidate, FindingCategory, FindingConfidence, FindingSeverity, ReviewFinding } from "../shared/types.js";
import { findDiffFile, nearestChangedNewLine } from "./diff.js";
import { PreprError } from "./errors.js";
import { validateRepoPath } from "./git.js";

export const severities = ["critical", "high", "medium", "low", "info"] as const satisfies readonly FindingSeverity[];
export const categories = ["bug", "security", "performance", "maintainability", "test", "docs", "style"] as const satisfies readonly FindingCategory[];
export const confidences = ["high", "medium", "low"] as const satisfies readonly FindingConfidence[];

export const codexJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "summary"],
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "claim", "severity", "category", "confidence", "location"],
        properties: {
          title: { type: "string" },
          claim: { type: "string" },
          severity: { enum: severities },
          category: { enum: categories },
          confidence: { enum: confidences },
          location: {
            type: "object",
            additionalProperties: false,
            required: ["file"],
            properties: {
              file: { type: "string" },
              line: { type: "number" }
            }
          },
          suggestion: { type: "string" }
        }
      }
    }
  }
};

export function parseAgentResponse(raw: string): { summary: string; findings: FindingCandidate[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PreprError(`Agent returned malformed JSON: ${(error as Error).message}`, "MALFORMED_AGENT_OUTPUT");
  }
  if (!isRecord(parsed) || typeof parsed.summary !== "string" || !Array.isArray(parsed.findings)) {
    throw new PreprError("Agent JSON must contain { summary, findings }.", "MALFORMED_AGENT_OUTPUT");
  }
  return {
    summary: parsed.summary,
    findings: parsed.findings.map(validateCandidate)
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
    suggestion: typeof value.suggestion === "string" ? value.suggestion : undefined
  };
  validateRepoPath(candidate.location.file);
  candidate.location.file = normalizeCandidatePath(candidate.location.file);
  return candidate;
}

export function normalizeFindings(
  candidates: FindingCandidate[],
  diff: DiffFile[],
  options: {
    agent: "codex" | "none";
    createdAt: string;
    dismissedFingerprints: Set<string>;
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
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const fixedAgain = options.fixedFingerprints?.has(fingerprint) ?? false;
    findings.push({
      ...anchored,
      id: shortHash(`${fingerprint}:${options.createdAt}`),
      agent: options.agent,
      createdAt: options.createdAt,
      fingerprint,
      status: options.dismissedFingerprints.has(fingerprint) ? "dismissed" : fixedAgain ? "open" : "open",
      isNew: true
    });
  }
  return findings;
}

export function reconcileFindings(previous: ReviewFinding[], current: ReviewFinding[], dismissedFingerprints: Set<string>): ReviewFinding[] {
  const currentFingerprints = new Set(current.map((f) => f.fingerprint));
  const carryResolved = previous
    .filter((f) => !currentFingerprints.has(f.fingerprint) && f.status !== "resolved")
    .map((f) => ({ ...f, status: "resolved" as const, isNew: false }));
  return [
    ...current.map((finding) => {
      const prior = previous.find((p) => p.fingerprint === finding.fingerprint);
      const status: ReviewFinding["status"] = dismissedFingerprints.has(finding.fingerprint) || prior?.status === "dismissed" ? "dismissed" : "open";
      return {
        ...finding,
        status,
        isNew: !prior
      };
    }),
    ...carryResolved
  ];
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
