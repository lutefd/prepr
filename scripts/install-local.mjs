#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const installDir = process.env.PREPR_INSTALL_DIR || path.join(os.homedir(), ".local", "bin");
const shellProfile = process.env.PREPR_SHELL_PROFILE || defaultShellProfile();
const skipShellSetup = process.env.PREPR_SKIP_SHELL_SETUP === "1";
const source = path.join(".prepr", "bin", "prepr");
const target = path.join(installDir, "prepr");

run("npm", ["run", "bundle"]);
mkdirSync(installDir, { recursive: true });
copyFileSync(source, target);
chmodSync(target, 0o755);

const shellUpdated = skipShellSetup ? false : ensurePathSetup(shellProfile, installDir);

console.log(`Installed prepr to ${target}`);
if (skipShellSetup) {
  console.log(`Shell setup skipped. Make sure ${installDir} is on your PATH.`);
} else {
  console.log(`${shellUpdated ? "Updated" : "Verified"} ${shellProfile} so ${installDir} is on your PATH.`);
  console.log(`Run: source ${shellProfile}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function defaultShellProfile() {
  const shell = path.basename(process.env.SHELL || "");
  if (shell === "bash") return path.join(os.homedir(), ".bashrc");
  return path.join(os.homedir(), ".zshrc");
}

function ensurePathSetup(profile, directory) {
  mkdirSync(path.dirname(profile), { recursive: true });
  const current = existsSync(profile) ? readFileSync(profile, "utf8") : "";
  const markerStart = "# >>> prepr install >>>";
  const markerEnd = "# <<< prepr install <<<";
  if (current.includes(markerStart)) return false;
  const block = [
    markerStart,
    `export PATH="${directory}:$PATH"`,
    markerEnd
  ].join("\n");
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  writeFileSync(profile, `${current}${prefix}${block}\n`);
  return true;
}
