import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("../app/api/sync/opiu-report/route.ts", import.meta.url),
  "utf8",
);

test("OPIU report cron returns a failing HTTP status when WB sync throws", () => {
  const catchBlock = route.slice(route.indexOf("} catch (error) {"));

  assert.match(catchBlock, /NextResponse\.json\([\s\S]*\{ status: 502 \}\)/);
  assert.doesNotMatch(catchBlock, /return NextResponse\.json\([\s\S]*\);\s*}\s*return NextResponse\.json/);
});
