import { spawn } from "node:child_process";
import { codexJsonSchema, parseAgentResponse } from "../core/schema.js";
import { PreprError } from "../core/errors.js";
import type { AgentResult, AgentRunner } from "./runner.js";

export class CodexRunner implements AgentRunner {
  constructor(private readonly timeoutMs = 10 * 60 * 1000) {}

  async run(bundle: string): Promise<AgentResult> {
    const prompt = [
      "You are reviewing a Git branch. Return only JSON matching this schema.",
      JSON.stringify(codexJsonSchema),
      "Report concrete, actionable findings only. Do not include generated fields such as id, status, fingerprint, agent, or timestamp.",
      bundle
    ].join("\n\n");
    return runCodexProcess(prompt, this.timeoutMs);
  }
}

export async function runCodexProcess(input: string, timeoutMs: number): Promise<AgentResult> {
  const args = ["exec", "--sandbox", "read-only", "--json", "--skip-git-repo-check", "-"];
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new PreprError("Codex review timed out after ten minutes.", "AGENT_TIMEOUT"));
      }
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new PreprError(`Unable to start Codex: ${error.message}`, "AGENT_START_FAILED"));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new PreprError(`Codex exited with status ${code}. See agent.log for details.`, "AGENT_FAILED", { stdout, stderr }));
        return;
      }
      const final = extractFinalJson(stdout);
      const parsed = parseAgentResponse(final);
      resolve({ ...parsed, raw: final, log: `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}` });
    });
    child.stdin.end(input);
  });
}

function extractFinalJson(stdout: string): string {
  const trimmed = stdout.trim();
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  for (const line of lines.toReversed()) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      for (const key of ["response", "message", "content", "output", "final"]) {
        if (typeof event[key] === "string" && event[key].trim().startsWith("{")) return event[key] as string;
      }
    } catch {
      // Plain JSON output is accepted below.
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new PreprError("Codex did not emit a JSON response.", "MALFORMED_AGENT_OUTPUT");
}
