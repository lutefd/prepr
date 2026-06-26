import path from "node:path";
import { execFileText } from "./process.js";
import { PreprError, assertPrepr } from "./errors.js";

export interface GitRefs {
  repoRoot: string;
  branch: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
}

export async function resolveRepoRoot(cwd = process.cwd()): Promise<string> {
  const { stdout } = await execFileText("git", ["rev-parse", "--show-toplevel"], { cwd });
  return stdout.trim();
}

export async function requireCleanTree(repoRoot: string): Promise<void> {
  const { stdout } = await execFileText("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: repoRoot });
  const dirty = stdout
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.includes(".prepr/"));
  if (dirty.length) {
    throw new PreprError(`Working tree must be clean before review. Commit, stash, or remove these changes:\n${dirty.join("\n")}`, "DIRTY_TREE");
  }
}

export async function resolveRefs(repoRoot: string, baseRef: string, headRef: string): Promise<GitRefs> {
  try {
    const [base, head, mergeBase, branch] = await Promise.all([
      execFileText("git", ["rev-parse", "--verify", `${baseRef}^{commit}`], { cwd: repoRoot }),
      execFileText("git", ["rev-parse", "--verify", `${headRef}^{commit}`], { cwd: repoRoot }),
      execFileText("git", ["merge-base", baseRef, headRef], { cwd: repoRoot }),
      execFileText("git", ["rev-parse", "--abbrev-ref", headRef], { cwd: repoRoot })
    ]);
    return {
      repoRoot,
      branch: sanitizeBranch(branch.stdout.trim() === "HEAD" ? headRef : branch.stdout.trim()),
      baseRef,
      headRef,
      baseSha: base.stdout.trim(),
      headSha: head.stdout.trim(),
      mergeBaseSha: mergeBase.stdout.trim()
    };
  } catch (error) {
    if (error instanceof PreprError) {
      throw new PreprError(`Unable to resolve --base ${baseRef} and --head ${headRef}. Check that both refs exist and share history.`, "INVALID_REF", error.details);
    }
    throw error;
  }
}

export async function rawDiff(repoRoot: string, mergeBaseSha: string, headSha: string): Promise<string> {
  const { stdout } = await execFileText("git", ["diff", "--find-renames", "--binary", "--unified=80", `${mergeBaseSha}..${headSha}`], { cwd: repoRoot });
  assertPrepr(stdout.trim().length > 0, "No changes found between merge base and head.", "EMPTY_DIFF");
  return stdout;
}

export async function diffStat(repoRoot: string, mergeBaseSha: string, headSha: string): Promise<string> {
  const { stdout } = await execFileText("git", ["diff", "--stat", "--find-renames", `${mergeBaseSha}..${headSha}`], { cwd: repoRoot });
  return stdout;
}

export async function changedPaths(repoRoot: string, mergeBaseSha: string, headSha: string): Promise<string[]> {
  const { stdout } = await execFileText("git", ["diff", "--name-only", "--find-renames", `${mergeBaseSha}..${headSha}`], { cwd: repoRoot });
  return stdout.split("\n").map((x) => x.trim()).filter(Boolean).sort();
}

export async function commitMessages(repoRoot: string, mergeBaseSha: string, headSha: string): Promise<string> {
  const { stdout } = await execFileText("git", ["log", "--format=%h %s", `${mergeBaseSha}..${headSha}`], { cwd: repoRoot });
  return stdout.trim();
}

export async function showFileAtRef(repoRoot: string, ref: string, file: string): Promise<string | undefined> {
  validateRepoPath(file);
  try {
    const { stdout } = await execFileText("git", ["show", `${ref}:${file}`], { cwd: repoRoot });
    return stdout;
  } catch {
    return undefined;
  }
}

export async function ensureLocalExclude(repoRoot: string): Promise<void> {
  const { stdout } = await execFileText("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: repoRoot });
  const exclude = path.isAbsolute(stdout.trim()) ? stdout.trim() : path.resolve(repoRoot, stdout.trim());
  const fs = await import("node:fs/promises");
  await fs.mkdir(path.dirname(exclude), { recursive: true });
  const current = await fs.readFile(exclude, "utf8").catch(() => "");
  if (!current.split(/\r?\n/).includes(".prepr/")) {
    await fs.appendFile(exclude, `${current.endsWith("\n") || current.length === 0 ? "" : "\n"}.prepr/\n`);
  }
}

export function validateRepoPath(file: string): void {
  if (!file || path.isAbsolute(file) || file.includes("\0")) {
    throw new PreprError(`Invalid repository path: ${file}`, "INVALID_PATH");
  }
  const normalized = path.posix.normalize(file.replaceAll("\\", "/"));
  if (normalized.startsWith("../") || normalized === "..") {
    throw new PreprError(`Path escapes repository: ${file}`, "INVALID_PATH");
  }
}

function sanitizeBranch(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "detached";
}
