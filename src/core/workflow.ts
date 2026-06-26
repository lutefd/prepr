import type { AgentRunner } from "../agents/runner.js";
import type {
  CoverageReceipt,
  FindingCandidate,
  ReviewFinding,
  ReviewWorkflowResult,
  ScannedCandidate,
  VerificationDecision
} from "../shared/types.js";
import { PreprError } from "./errors.js";
import { evidenceErrors, type EvidenceContext } from "./evidence.js";

export const MINIMUM_CONFIDENCE = 0.8;

export async function runReviewWorkflow(input: {
  runner: AgentRunner;
  bundle: string;
  workspace: string;
  previous?: ReviewFinding[];
  evidenceContext?: Omit<EvidenceContext, "agentLog">;
}): Promise<ReviewWorkflowResult> {
  const scanStage = await input.runner.runScan({ bundle: input.bundle, workspace: input.workspace });
  const verificationStage = await input.runner.runVerification({
    bundle: input.bundle,
    workspace: input.workspace,
    candidates: scanStage.output.candidates,
    previous: input.previous ?? []
  });
  const decisions = indexDecisions(verificationStage.output.decisions, scanStage.output.candidates);
  const findings: FindingCandidate[] = [];
  const suppressed: ReviewWorkflowResult["suppressed"] = [];

  for (const candidate of scanStage.output.candidates) {
    const decision = decisions.get(candidate.candidateId);
    if (!decision) {
      suppressed.push({ candidate, reason: "missing_decision" });
      continue;
    }
    if (decision.verdict === "rejected" || decision.verdict === "uncertain") {
      suppressed.push({ candidate, decision, reason: decision.verdict });
      continue;
    }
    if (decision.confidence < MINIMUM_CONFIDENCE) {
      suppressed.push({ candidate, decision, reason: "low_confidence" });
      continue;
    }
    if (input.evidenceContext) {
      const errors = await evidenceErrors(decision.evidence, {
        ...input.evidenceContext,
        agentLog: `${scanStage.log}\n${verificationStage.log}`
      });
      if (errors.length) {
        suppressed.push({ candidate, decision, reason: "invalid_evidence", evidenceErrors: errors });
        continue;
      }
    }
    findings.push(applyDecision(candidate, decision));
  }

  return {
    scan: scanStage.output,
    verification: verificationStage.output,
    findings,
    suppressed,
    coverage: mergeCoverage(scanStage.output.coverage, verificationStage.output.coverage),
    log: ["[scan]", scanStage.log, "[verification]", verificationStage.log].join("\n")
  };
}

function indexDecisions(decisions: VerificationDecision[], candidates: ScannedCandidate[]): Map<string, VerificationDecision> {
  const validIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const indexed = new Map<string, VerificationDecision>();
  for (const decision of decisions) {
    if (!validIds.has(decision.candidateId)) {
      throw new PreprError(`Verifier referenced unknown candidate ${decision.candidateId}.`, "UNKNOWN_CANDIDATE");
    }
    if (indexed.has(decision.candidateId)) {
      throw new PreprError(`Verifier returned duplicate decisions for ${decision.candidateId}.`, "DUPLICATE_DECISION");
    }
    indexed.set(decision.candidateId, decision);
  }
  return indexed;
}

function applyDecision(candidate: ScannedCandidate, decision: VerificationDecision): FindingCandidate {
  return {
    title: candidate.title,
    claim: candidate.claim,
    severity: decision.severity ?? candidate.severity,
    category: decision.category ?? candidate.category,
    confidence: confidenceLabel(decision.confidence),
    location: decision.location ?? candidate.location,
    impact: candidate.impact,
    trigger: candidate.trigger,
    evidence: decision.evidence,
    counterEvidence: candidate.counterEvidence,
    suggestion: decision.suggestion ?? candidate.suggestion
  };
}

function confidenceLabel(confidence: number): FindingCandidate["confidence"] {
  if (confidence >= 0.9) return "high";
  if (confidence >= MINIMUM_CONFIDENCE) return "medium";
  return "low";
}

function mergeCoverage(scan: CoverageReceipt, verification: CoverageReceipt): CoverageReceipt {
  return {
    reviewedFiles: unique([...scan.reviewedFiles, ...verification.reviewedFiles]),
    reviewedHunks: Math.max(scan.reviewedHunks, verification.reviewedHunks),
    exploredSymbols: unique([...scan.exploredSymbols, ...verification.exploredSymbols]),
    checks: unique([...scan.checks, ...verification.checks]),
    skippedContext: unique([...scan.skippedContext, ...verification.skippedContext]),
    notes: unique([...scan.notes, ...verification.notes])
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
