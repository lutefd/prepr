import { spawn } from "node:child_process";
import type { CheckConfig, CheckResult } from "../shared/types.js";

const MAX_OUTPUT_BYTES = 200 * 1024;

export async function runConfiguredChecks(checks: CheckConfig[], workspace: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) results.push(await runCheck(check, workspace));
  return results;
}

export function renderCheckResults(results: CheckResult[]): string {
  if (!results.length) return "(no configured checks)";
  return results
    .map((result) => [
      `### ${result.id}: ${result.status}`,
      `command: ${JSON.stringify(result.command)}`,
      `duration_ms: ${result.durationMs}`,
      result.exitCode === undefined ? "" : `exit_code: ${result.exitCode}`,
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
      result.truncated ? "[output truncated]" : ""
    ].filter(Boolean).join("\n"))
    .join("\n\n");
}

async function runCheck(check: CheckConfig, workspace: string): Promise<CheckResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const command = [check.command, ...(check.args ?? [])];
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const child = spawn(check.command, check.args ?? [], { cwd: workspace, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, check.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const next = appendBounded(stdout, chunk);
      stdout = next.value;
      truncated ||= next.truncated;
    });
    child.stderr.on("data", (chunk) => {
      const next = appendBounded(stderr, chunk);
      stderr = next.value;
      truncated ||= next.truncated;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ id: check.id, command, status: "error", durationMs: Date.now() - started, stdout, stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`, truncated });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        id: check.id,
        command,
        status: timedOut ? "timed_out" : code === 0 ? "passed" : "failed",
        exitCode: code ?? undefined,
        durationMs: Date.now() - started,
        stdout,
        stderr,
        truncated
      });
    });
  });
}

function appendBounded(current: string, chunk: string): { value: string; truncated: boolean } {
  const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(current);
  if (remaining <= 0) return { value: current, truncated: true };
  const buffer = Buffer.from(chunk);
  if (buffer.byteLength <= remaining) return { value: current + chunk, truncated: false };
  return { value: current + buffer.subarray(0, remaining).toString("utf8"), truncated: true };
}
