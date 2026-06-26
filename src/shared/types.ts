export type FindingStatus = "open" | "dismissed" | "fixed" | "resolved";
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingCategory =
  | "bug"
  | "security"
  | "performance"
  | "maintainability"
  | "test"
  | "docs"
  | "style";
export type FindingConfidence = "high" | "medium" | "low";
export type ReviewStage = "scan" | "verify";
export type VerificationVerdict = "confirmed" | "rejected" | "uncertain";
export type EvidenceKind = "diff" | "base_file" | "head_file" | "check" | "command";

export interface EvidenceRef {
  kind: EvidenceKind;
  explanation: string;
  file?: string;
  ref?: string;
  side?: "base" | "head";
  lineStart?: number;
  lineEnd?: number;
  checkId?: string;
  commandId?: string;
  excerpt?: string;
}

export interface CoverageReceipt {
  reviewedFiles: string[];
  reviewedHunks: number;
  exploredSymbols: string[];
  checks: string[];
  skippedContext: string[];
  notes: string[];
}

export interface FindingLocation {
  file: string;
  line?: number;
}

export interface FindingCandidate {
  title: string;
  claim: string;
  severity: FindingSeverity;
  category: FindingCategory;
  confidence: FindingConfidence;
  location: FindingLocation;
  impact?: string;
  trigger?: string;
  evidence: EvidenceRef[];
  counterEvidence?: string[];
  suggestion?: string;
}

export interface ScannedCandidate extends FindingCandidate {
  candidateId: string;
}

export interface ScanResult {
  schemaVersion: 1;
  summary: string;
  candidates: ScannedCandidate[];
  coverage: CoverageReceipt;
}

export interface VerificationDecision {
  candidateId: string;
  verdict: VerificationVerdict;
  rationale: string;
  confidence: number;
  evidence: EvidenceRef[];
  severity?: FindingSeverity;
  category?: FindingCategory;
  location?: FindingLocation;
  suggestion?: string;
  relatedPreviousFindingId?: string;
}

export interface VerificationResult {
  schemaVersion: 1;
  summary: string;
  decisions: VerificationDecision[];
  coverage: CoverageReceipt;
}

export interface SuppressedCandidate {
  candidate: ScannedCandidate;
  decision?: VerificationDecision;
  reason: "rejected" | "uncertain" | "low_confidence" | "missing_decision";
}

export interface ReviewWorkflowResult {
  scan: ScanResult;
  verification: VerificationResult;
  findings: FindingCandidate[];
  suppressed: SuppressedCandidate[];
  coverage: CoverageReceipt;
  log: string;
}

export interface ReviewFinding extends FindingCandidate {
  id: string;
  agent: "codex" | "none";
  createdAt: string;
  fingerprint: string;
  status: FindingStatus;
  isNew?: boolean;
}

export interface DiffLine {
  kind: "context" | "add" | "del";
  content: string;
  oldLine?: number;
  newLine?: number;
  changed: boolean;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath?: string;
  newPath: string;
  status: "added" | "modified" | "deleted" | "renamed" | "binary";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  binary?: boolean;
}

export interface RunMetadata {
  id: string;
  repoRoot: string;
  branch: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
  createdAt: string;
  risk: "low" | "medium" | "high";
  only?: FindingCategory[];
  agent: "codex" | "none";
  counts: {
    files: number;
    findings: number;
    open: number;
    dismissed: number;
    fixed: number;
    resolved: number;
  };
}

export interface ReviewRun {
  metadata: RunMetadata;
  diff: DiffFile[];
  findings: ReviewFinding[];
  summary: string;
  coverage?: CoverageReceipt;
  uiState?: Record<string, unknown>;
}

export interface RerunJob {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  createdAt: string;
  completedAt?: string;
  runId?: string;
  error?: string;
}
