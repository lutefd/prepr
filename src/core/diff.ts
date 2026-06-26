import type { DiffFile, DiffHunk, DiffLine } from "../shared/types.js";

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  const lines = patch.split("\n");

  for (const raw of lines) {
    if (raw.startsWith("diff --git ")) {
      if (current) files.push(current);
      current = {
        newPath: parseGitPath(raw.split(" b/")[1] ?? "unknown"),
        status: "modified",
        additions: 0,
        deletions: 0,
        hunks: []
      };
      hunk = undefined;
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("rename from ")) {
      current.oldPath = parseGitPath(raw.slice("rename from ".length));
      current.status = "renamed";
      continue;
    }
    if (raw.startsWith("rename to ")) {
      current.newPath = parseGitPath(raw.slice("rename to ".length));
      current.status = "renamed";
      continue;
    }
    if (raw.startsWith("new file mode ")) current.status = "added";
    if (raw.startsWith("deleted file mode ")) current.status = "deleted";
    if (raw.startsWith("Binary files ")) {
      current.status = "binary";
      current.binary = true;
    }
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4);
      if (p !== "/dev/null") current.newPath = parseGitPath(p.replace(/^b\//, ""));
    }
    const match = raw.match(HUNK_RE);
    if (match) {
      oldLine = Number(match[1]);
      newLine = Number(match[3]);
      hunk = {
        header: raw,
        oldStart: oldLine,
        oldLines: Number(match[2] ?? "1"),
        newStart: newLine,
        newLines: Number(match[4] ?? "1"),
        lines: []
      };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      hunk.lines.push({ kind: "add", content: raw.slice(1), newLine, changed: true });
      current.additions++;
      newLine++;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      hunk.lines.push({ kind: "del", content: raw.slice(1), oldLine, changed: true });
      current.deletions++;
      oldLine++;
    } else if (raw.startsWith(" ")) {
      hunk.lines.push({ kind: "context", content: raw.slice(1), oldLine, newLine, changed: false });
      oldLine++;
      newLine++;
    } else if (raw === "\\ No newline at end of file") {
      continue;
    }
  }
  if (current) files.push(current);
  return files;
}

export function nearestChangedNewLine(file: DiffFile, requested?: number): number | undefined {
  const changed = file.hunks.flatMap((h) => h.lines.filter((l) => l.kind === "add" && l.newLine).map((l) => l.newLine as number));
  if (!changed.length) return undefined;
  if (!requested) return changed[0];
  return changed.reduce((best, line) => (Math.abs(line - requested) < Math.abs(best - requested) ? line : best), changed[0]);
}

function parseGitPath(path: string): string {
  return path.replace(/^"|"$/g, "").replace(/^a\//, "").replace(/^b\//, "");
}

export function findDiffFile(files: DiffFile[], file: string): DiffFile | undefined {
  const normalized = file.replaceAll("\\", "/");
  return files.find((f) => f.newPath === normalized || f.oldPath === normalized);
}
