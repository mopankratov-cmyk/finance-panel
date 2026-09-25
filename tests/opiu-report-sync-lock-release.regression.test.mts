import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("report sync releases its cooperative lock at resumable boundaries", () => {
  const source = readFileSync(new URL("../lib/opiu/syncReportRows.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /if \(Date\.now\(\) - startedAt > SOFT_TIME_BUDGET_MS\) \{[\s\S]*?await persist\("pending", null\);[\s\S]*?complete: false/,
  );
  assert.match(
    source,
    /await persist\("pending", null\);\s*return \{ synced, pages, lastRrdId: cursor, complete: false \};/,
  );
});
