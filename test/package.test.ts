import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("provides a single bundle command for backend, frontend, and executable packaging", async () => {
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
  assert.equal(pkg.bin.prepr, "./dist/cli/index.js");
  assert.equal(pkg.scripts.bundle, "node scripts/bundle.mjs");
  assert.equal(pkg.scripts["install:local"], "node scripts/install-local.mjs");
  assert.deepEqual(pkg.files, ["dist", "ui/dist"]);
  const script = await fs.readFile("scripts/bundle.mjs", "utf8");
  assert.match(script, /\.prepr\/bin/);
  assert.match(script, /__PREPR_PAYLOAD__/);
  assert.doesNotMatch(script, /npm", \["pack"/);
  const installer = await fs.readFile("scripts/install-local.mjs", "utf8");
  assert.match(installer, /PREPR_INSTALL_DIR/);
  assert.match(installer, /PREPR_SHELL_PROFILE/);
  assert.match(installer, /PREPR_SKIP_SHELL_SETUP/);
  assert.match(installer, /npm", \["run", "bundle"\]/);
  assert.match(installer, /# >>> prepr install >>>/);
  assert.match(installer, /source \$\{shellProfile\}/);
});
