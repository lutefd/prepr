import fs from "node:fs/promises";
import path from "node:path";
import type { CheckConfig, PreprConfig } from "../shared/types.js";
import { PreprError } from "./errors.js";

const DEFAULT_CHECK_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CHECK_TIMEOUT_MS = 30 * 60 * 1000;

export async function loadConfig(repoRoot: string): Promise<PreprConfig> {
  const file = path.join(repoRoot, ".prepr", "config.json");
  const raw = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (raw === undefined) return { schemaVersion: 1, checks: [] };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new PreprError(`Invalid .prepr/config.json: ${(error as Error).message}`, "INVALID_CONFIG");
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.checks)) {
    throw new PreprError(".prepr/config.json must contain { schemaVersion: 1, checks: [] }.", "INVALID_CONFIG");
  }
  const checks = value.checks.map(validateCheck);
  const ids = new Set<string>();
  for (const check of checks) {
    if (ids.has(check.id)) throw new PreprError(`Duplicate configured check id: ${check.id}`, "INVALID_CONFIG");
    ids.add(check.id);
  }
  return { schemaVersion: 1, checks };
}

function validateCheck(value: unknown): CheckConfig {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.command !== "string" || !value.command.trim()) {
    throw new PreprError("Each configured check requires non-empty id and command strings.", "INVALID_CONFIG");
  }
  if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== "string"))) {
    throw new PreprError(`Configured check ${value.id} args must be an array of strings.`, "INVALID_CONFIG");
  }
  const timeoutMs = value.timeoutMs === undefined ? DEFAULT_CHECK_TIMEOUT_MS : value.timeoutMs;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_CHECK_TIMEOUT_MS) {
    throw new PreprError(`Configured check ${value.id} timeoutMs must be between 1 and ${MAX_CHECK_TIMEOUT_MS}.`, "INVALID_CONFIG");
  }
  return {
    id: value.id.trim(),
    command: value.command.trim(),
    args: value.args as string[] | undefined,
    timeoutMs
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
