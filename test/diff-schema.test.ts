import assert from "node:assert/strict";
import test from "node:test";
import { parseDiff } from "../src/core/diff.js";
import { normalizeFindings } from "../src/core/schema.js";
import type { FindingCandidate } from "../src/shared/types.js";

test("parses unified diff hunks and anchors findings to changed new-side lines", () => {
  const diff = parseDiff(`diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 const d = 5
`);
  assert.equal(diff[0].newPath, "src/a.ts");
  assert.equal(diff[0].additions, 2);
  assert.equal(diff[0].deletions, 1);
  const candidate: FindingCandidate = {
    title: "Bad math",
    claim: "The new value is wrong.",
    severity: "medium",
    category: "bug",
    confidence: "high",
    location: { file: "src/a.ts", line: 1 }
  };
  const findings = normalizeFindings([candidate, candidate], diff, {
    agent: "codex",
    createdAt: "2026-06-26T00:00:00.000Z",
    dismissedFingerprints: new Set()
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].location.line, 2);
  assert.equal(findings[0].status, "open");
});

test("rejects escaping candidate paths", () => {
  assert.throws(
    () =>
      normalizeFindings(
        [
          {
            title: "Escape",
            claim: "Escapes repo.",
            severity: "high",
            category: "security",
            confidence: "high",
            location: { file: "../secret", line: 1 }
          }
        ],
        [],
        { agent: "codex", createdAt: "2026-06-26T00:00:00.000Z", dismissedFingerprints: new Set() }
      ),
    /Path escapes repository/
  );
});
