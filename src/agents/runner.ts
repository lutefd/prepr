import type { ReviewFinding, ScanResult, ScannedCandidate, VerificationResult } from "../shared/types.js";

export interface AgentStageResult<T> {
  output: T;
  raw: string;
  log: string;
}

export interface AgentRunner {
  runScan(input: { bundle: string; workspace: string }): Promise<AgentStageResult<ScanResult>>;
  runVerification(input: {
    bundle: string;
    workspace: string;
    candidates: ScannedCandidate[];
    previous: ReviewFinding[];
  }): Promise<AgentStageResult<VerificationResult>>;
}
