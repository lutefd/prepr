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
  suggestion?: string;
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
