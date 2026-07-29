import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// Regression test for QA ISSUE-006: 390px viewport on /cabinets and /sync.
test("system layout and cabinet forms may shrink to the mobile viewport", () => {
  assert.match(source("components/AppLayout.tsx"), /<main className="min-w-0 flex-1 lg:ml-64">/);
  const cabinets = source("app/cabinets/page.tsx");
  assert.match(cabinets, /grid grid-cols-1 gap-2 sm:grid-cols-2/);
  assert.match(cabinets, /w-full min-w-0 rounded-lg/);
});

test("sync journal scrolls inside its card instead of widening the page", () => {
  const sync = source("components/sync/SyncPage.tsx");
  assert.match(sync, /max-w-full overflow-x-auto rounded-xl/);
  assert.match(sync, /w-full min-w-\[720px\] text-sm/);
});
