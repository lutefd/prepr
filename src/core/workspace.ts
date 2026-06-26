import fs from "node:fs/promises";
import path from "node:path";
import { execFileText } from "./process.js";

export async function createReviewWorkspace(repoRoot: string, runId: string, headSha: string): Promise<string> {
  const worktreesDir = path.join(repoRoot, ".prepr", "worktrees");
  const workspace = path.join(worktreesDir, runId);
  await fs.mkdir(worktreesDir, { recursive: true });
  await execFileText("git", ["worktree", "add", "--detach", workspace, headSha], { cwd: repoRoot });
  return workspace;
}

export async function restoreReviewWorkspace(workspace: string, headSha: string): Promise<void> {
  await execFileText("git", ["reset", "--hard", headSha], { cwd: workspace });
  await execFileText("git", ["clean", "-fdx"], { cwd: workspace });
}

export async function removeReviewWorkspace(repoRoot: string, workspace: string): Promise<void> {
  await execFileText("git", ["worktree", "remove", "--force", workspace], { cwd: repoRoot }).catch(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
    await execFileText("git", ["worktree", "prune"], { cwd: repoRoot }).catch(() => undefined);
  });
}
