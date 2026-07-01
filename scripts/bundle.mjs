#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const outDir = ".prepr/bin";
const executable = path.join(outDir, "prepr");
const stage = path.join(".prepr", "bundle-stage");
const payload = path.join(".prepr", "prepr-payload.tgz");

run("npm", ["run", "build"]);
rmSync(stage, { recursive: true, force: true });
mkdirSync(path.join(stage, "ui"), { recursive: true });
cpSync("package.json", path.join(stage, "package.json"));
cpSync("dist", path.join(stage, "dist"), { recursive: true });
cpSync(path.join("ui", "dist"), path.join(stage, "ui", "dist"), { recursive: true });

run("tar", ["-czf", payload, "-C", stage, "."]);

const payloadData = readFileSync(payload);
const hash = crypto.createHash("sha256").update(payloadData).digest("hex").slice(0, 16);
const encoded = payloadData.toString("base64").replace(/(.{76})/g, "$1\n");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  executable,
  [
    "#!/bin/sh",
    "set -eu",
    `PREPR_BUNDLE_HASH="${hash}"`,
    'CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/prepr"',
    'CACHE_DIR="$CACHE_ROOT/$PREPR_BUNDLE_HASH"',
    'ENTRY="$CACHE_DIR/dist/cli/index.js"',
    "",
    "decode_payload() {",
    "  if base64 --decode </dev/null >/dev/null 2>&1; then",
    "    base64 --decode",
    "  else",
    "    base64 -D",
    "  fi",
    "}",
    "",
    'if [ ! -f "$ENTRY" ]; then',
    '  TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/prepr.XXXXXX")"',
    '  mkdir -p "$CACHE_ROOT"',
    "  PAYLOAD_LINE=$(awk '/^__PREPR_PAYLOAD__$/ { print NR + 1; exit 0 }' \"$0\")",
    '  tail -n +"$PAYLOAD_LINE" "$0" | decode_payload | tar -xzf - -C "$TMP_DIR"',
    '  rm -rf "$CACHE_DIR"',
    '  mv "$TMP_DIR" "$CACHE_DIR"',
    "fi",
    "",
    'exec node "$ENTRY" "$@"',
    "__PREPR_PAYLOAD__",
    encoded
  ].join("\n")
);
chmodSync(executable, 0o755);
rmSync(stage, { recursive: true, force: true });
rmSync(payload, { force: true });

console.log(`Created ${path.resolve(executable)}`);

function run(command, args) {
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
