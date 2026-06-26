import { spawn } from "node:child_process";
import path from "node:path";
import { PreprError } from "../core/errors.js";
import { validateRepoPath } from "../core/git.js";
import { execFileText } from "../core/process.js";

export async function openEditor(repoRoot: string, file: string, line?: number): Promise<void> {
  validateRepoPath(file);
  const absolute = path.resolve(repoRoot, file);
  if (!absolute.startsWith(`${repoRoot}${path.sep}`) && absolute !== repoRoot) {
    throw new PreprError("Editor path escapes repository.", "INVALID_PATH");
  }
  const editor = await resolveEditor();
  const target = line ? `${absolute}:${line}` : absolute;
  const args = editor.includes("code") ? ["-g", target] : [target];
  const child = spawn(editor, args, { detached: true, stdio: "ignore" });
  child.unref();
}

async function resolveEditor(): Promise<string> {
  for (const candidate of [process.env.PREPR_EDITOR, process.env.VISUAL, process.env.EDITOR]) {
    if (candidate) return candidate;
  }
  await execFileText("which", ["code"]).catch(() => {
    throw new PreprError("No editor configured. Set PREPR_EDITOR, VISUAL, or EDITOR.", "EDITOR_NOT_FOUND");
  });
  return "code";
}
