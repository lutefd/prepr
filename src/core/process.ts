import { spawn } from "node:child_process";
import { PreprError } from "./errors.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export async function execFileText(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          if (!settled) {
            settled = true;
            child.kill("SIGTERM");
            reject(new PreprError(`${command} timed out after ${options.timeoutMs}ms`, "PROCESS_TIMEOUT"));
          }
        }, options.timeoutMs)
      : undefined;

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
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new PreprError(`${command} ${args.join(" ")} failed: ${stderr.trim() || `exit ${code}`}`, "PROCESS_FAILED", { stdout, stderr, code }));
      }
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
