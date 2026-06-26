import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunner } from "../src/agents/runner.js";
import { runReviewWorkflow } from "../src/core/workflow.js";
import type { CoverageReceipt, ScanResult, VerificationResult } from "../src/shared/types.js";

const coverage: CoverageReceipt = {
  reviewedFiles: ["src/cart.ts"],
  reviewedHunks: 1,
  exploredSymbols: ["loadCart"],
  checks: [],
  skippedContext: [],
  notes: []
};

function runner(scan: ScanResult, verification: VerificationResult): AgentRunner {
  return {
    async runScan() {
      return { output: scan, raw: JSON.stringify(scan), log: "scan log" };
    },
    async runVerification() {
      return { output: verification, raw: JSON.stringify(verification), log: "verification log" };
    }
  };
}

test("publishes only independently confirmed high-confidence candidates", async () => {
  const candidate = {
    candidateId: "candidate-001",
    title: "Empty carts receive defaults",
    claim: "The new order changes empty-cart behavior.",
    severity: "high" as const,
    category: "bug" as const,
    confidence: "high" as const,
    location: { file: "src/cart.ts", line: 42 },
    evidence: [{ kind: "diff" as const, explanation: "The guard moved after default construction.", file: "src/cart.ts", lineStart: 42 }]
  };
  const result = await runReviewWorkflow({
    runner: runner(
      { schemaVersion: 1, summary: "one candidate", candidates: [candidate], coverage },
      {
        schemaVersion: 1,
        summary: "confirmed",
        decisions: [
          {
            candidateId: candidate.candidateId,
            verdict: "confirmed",
            rationale: "The caller observes the changed behavior.",
            confidence: 0.91,
            evidence: [{ kind: "head_file", explanation: "The caller renders the returned defaults.", file: "src/cart.ts", lineStart: 42 }]
          }
        ],
        coverage
      }
    ),
    bundle: "bundle",
    workspace: "/repo"
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].confidence, "high");
  assert.deepEqual(result.findings[0].evidence, result.verification.decisions[0].evidence);
  assert.equal(result.suppressed.length, 0);
  assert.match(result.log, /\[verification\]/);
});

test("retains rejected and low-confidence candidates as diagnostics", async () => {
  const candidates = ["candidate-001", "candidate-002"].map((candidateId, index) => ({
    candidateId,
    title: `Candidate ${index + 1}`,
    claim: "Potential issue.",
    severity: "medium" as const,
    category: "bug" as const,
    confidence: "medium" as const,
    location: { file: "src/cart.ts", line: 42 },
    evidence: [{ kind: "diff" as const, explanation: "Potential evidence.", file: "src/cart.ts", lineStart: 42 }]
  }));
  const result = await runReviewWorkflow({
    runner: runner(
      { schemaVersion: 1, summary: "two candidates", candidates, coverage },
      {
        schemaVersion: 1,
        summary: "none published",
        decisions: [
          { candidateId: "candidate-001", verdict: "rejected", rationale: "Pre-existing behavior.", confidence: 0.98, evidence: candidates[0].evidence },
          { candidateId: "candidate-002", verdict: "confirmed", rationale: "Impact is possible but weak.", confidence: 0.62, evidence: candidates[1].evidence }
        ],
        coverage
      }
    ),
    bundle: "bundle",
    workspace: "/repo"
  });

  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.suppressed.map((item) => item.reason), ["rejected", "low_confidence"]);
});
