import path from "node:path";
import type { CheckResult, DiffFile, FindingCategory } from "../shared/types.js";
import { renderCheckResults } from "./checks.js";
import { PreprError } from "./errors.js";
import { changedPaths, commitMessages, diffStat, showFileAtRef } from "./git.js";

const SUPPLEMENTAL_FILE_LIMIT = 200 * 1024;
const SUPPLEMENTAL_TOTAL_LIMIT = 1024 * 1024;
const TOTAL_BUNDLE_LIMIT = 4 * 1024 * 1024;

export interface BundleInput {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  mergeBaseSha: string;
  headSha: string;
  patch: string;
  diff: DiffFile[];
  risk: "low" | "medium" | "high";
  only?: FindingCategory[];
  checks?: CheckResult[];
}

export async function buildBundle(input: BundleInput): Promise<{ bundle: string; supplemental: Record<string, string> }> {
  if (Buffer.byteLength(input.patch) > TOTAL_BUNDLE_LIMIT) {
    throw new PreprError("Patch exceeds the 4 MiB review bundle limit. Split the branch or narrow the change before reviewing.", "BUNDLE_TOO_LARGE");
  }
  const [stat, commits, paths, instructions] = await Promise.all([
    diffStat(input.repoRoot, input.mergeBaseSha, input.headSha),
    commitMessages(input.repoRoot, input.mergeBaseSha, input.headSha),
    changedPaths(input.repoRoot, input.mergeBaseSha, input.headSha),
    Promise.resolve(instructionFiles())
  ]);
  const supplemental: Record<string, string> = {};
  let supplementalBytes = 0;
  const candidates = [...new Set([...paths, ...nearbyTests(paths), ...instructions])].sort();
  for (const file of candidates) {
    const content = await showFileAtRef(input.repoRoot, input.headSha, file);
    if (content === undefined) continue;
    const clipped = limitText(content, SUPPLEMENTAL_FILE_LIMIT);
    const bytes = Buffer.byteLength(clipped);
    if (supplementalBytes + bytes > SUPPLEMENTAL_TOTAL_LIMIT) continue;
    supplemental[file] = clipped;
    supplementalBytes += bytes;
  }

  const bundle = [
    "# prepr review bundle",
    "",
    `baseRef: ${input.baseRef}`,
    `headRef: ${input.headRef}`,
    `headSha: ${input.headSha}`,
    `risk: ${input.risk}`,
    `only: ${input.only?.join(",") || "all"}`,
    "",
    "## commit messages",
    commits || "(none)",
    "",
    "## diff stat",
    stat || "(none)",
    "",
    "## changed paths",
    paths.join("\n"),
    "",
    "## repository instructions and bounded file context",
    ...Object.entries(supplemental).flatMap(([file, content]) => [`### ${file}`, "```", content, "```", ""]),
    "## configured check output",
    renderCheckResults(input.checks ?? []),
    "",
    "## patch",
    "```diff",
    input.patch,
    "```"
  ].join("\n");

  if (Buffer.byteLength(bundle) > TOTAL_BUNDLE_LIMIT) {
    throw new PreprError("Review bundle exceeds 4 MiB after supplemental context. Split the branch or reduce changed files.", "BUNDLE_TOO_LARGE");
  }
  return { bundle, supplemental };
}

function instructionFiles(): string[] {
  return ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", ".github/copilot-instructions.md"];
}

function nearbyTests(paths: string[]): string[] {
  const tests = new Set<string>();
  for (const file of paths) {
    const parsed = path.posix.parse(file);
    const base = parsed.name.replace(/\.(test|spec)$/, "");
    for (const ext of [parsed.ext, ".ts", ".tsx", ".js", ".jsx"]) {
      tests.add(path.posix.join(parsed.dir, `${base}.test${ext}`));
      tests.add(path.posix.join(parsed.dir, `${base}.spec${ext}`));
      tests.add(path.posix.join(parsed.dir, "__tests__", `${base}.test${ext}`));
    }
  }
  return [...tests];
}

function limitText(content: string, maxBytes: number): string {
  if (Buffer.byteLength(content) <= maxBytes) return content;
  return `${content.slice(0, maxBytes)}\n[truncated at ${maxBytes} bytes]`;
}
