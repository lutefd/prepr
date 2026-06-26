import type { FindingCandidate } from "../shared/types.js";

export interface AgentResult {
  summary: string;
  findings: FindingCandidate[];
  raw: string;
  log: string;
}

export interface AgentRunner {
  run(bundle: string): Promise<AgentResult>;
}
