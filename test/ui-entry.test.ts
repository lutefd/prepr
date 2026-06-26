import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("mounts the application with the Svelte 5 component API", async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const entry = await fs.readFile(path.resolve(testDir, "../ui/src/main.ts"), "utf8");
  assert.match(entry, /import \{ mount \} from "svelte"/);
  assert.match(entry, /mount\(App,/);
  assert.doesNotMatch(entry, /new App\(/);
});
