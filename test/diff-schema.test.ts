import assert from "node:assert/strict";
import test from "node:test";
import { parseDiff } from "../src/core/diff.js";
import { normalizeFindings, scanJsonSchema, verificationJsonSchema } from "../src/core/schema.js";
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
    location: { file: "src/a.ts", line: 1 },
    evidence: [{ kind: "diff", explanation: "The changed value is visible in the diff.", file: "src/a.ts", lineStart: 2 }]
  };
  const findings = normalizeFindings([candidate, candidate], diff, {
    agent: "codex",
    createdAt: "2026-06-26T00:00:00.000Z",
    dismissals: []
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
            location: { file: "../secret", line: 1 },
            evidence: [{ kind: "diff", explanation: "Invalid path evidence.", file: "../secret" }]
          }
        ],
        [],
        { agent: "codex", createdAt: "2026-06-26T00:00:00.000Z", dismissals: [] }
      ),
    /Path escapes repository/
  );
});

test("carries dismissals only while the anchored code region still matches", () => {
  const originalDiff = parseDiff(`diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-const value = 1
+const value = 2
 export const result = value
`);
  const candidate: FindingCandidate = {
    title: "Changed result",
    claim: "The new value changes the exported result.",
    severity: "medium",
    category: "bug",
    confidence: "high",
    location: { file: "src/a.ts", line: 1 },
    evidence: [{ kind: "diff", explanation: "The value changed.", file: "src/a.ts", lineStart: 1 }]
  };
  const [initial] = normalizeFindings([candidate], originalDiff, {
    agent: "codex",
    createdAt: "2026-06-26T00:00:00.000Z",
    dismissals: []
  });
  const dismissal = { fingerprint: initial.fingerprint, regionHash: initial.regionHash, reason: "intentional" as const, createdAt: "2026-06-26T00:01:00.000Z" };
  const [unchanged] = normalizeFindings([candidate], originalDiff, {
    agent: "codex",
    createdAt: "2026-06-26T00:02:00.000Z",
    dismissals: [dismissal]
  });
  assert.equal(unchanged.status, "dismissed");

  const changedDiff = parseDiff(`diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-const value = 1
+const value = 3
 export const result = value
`);
  const [resurfaced] = normalizeFindings([candidate], changedDiff, {
    agent: "codex",
    createdAt: "2026-06-26T00:03:00.000Z",
    dismissals: [dismissal]
  });
  assert.equal(resurfaced.status, "open");
});

test("agent output schemas require every declared object property", () => {
  assertStrictObjects(scanJsonSchema, "scan");
  assertStrictObjects(verificationJsonSchema, "verification");
});

function assertStrictObjects(schema: unknown, path: string): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  const node = schema as Record<string, unknown>;
  if (node.properties && typeof node.properties === "object" && !Array.isArray(node.properties)) {
    const properties = Object.keys(node.properties as Record<string, unknown>).sort();
    const required = Array.isArray(node.required) ? [...node.required].sort() : [];
    assert.deepEqual(required, properties, `${path} must require every property for strict structured output`);
    for (const [key, child] of Object.entries(node.properties as Record<string, unknown>)) assertStrictObjects(child, `${path}.${key}`);
  }
  if (node.items) assertStrictObjects(node.items, `${path}[]`);
  if (Array.isArray(node.anyOf)) node.anyOf.forEach((child, index) => assertStrictObjects(child, `${path}.anyOf[${index}]`));
}
