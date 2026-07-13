import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "components/dashboard/ModulesHome.tsx"), "utf8");

test("dashboard launcher keeps removed tools out of the module catalog", () => {
  for (const removedTitle of ["Планирование", "Здоровье", "UGC Studio"]) {
    assert.equal(source.includes(`title: "${removedTitle}"`), false, removedTitle);
  }
});

test("dashboard launcher names the approved WB tools consistently", () => {
  assert.match(source, /title: "CTR-тесты"/);
  assert.match(source, /title: "Поставки"/);
});

test("dashboard launcher resets legacy disclosure state once", () => {
  assert.match(source, /DISCLOSURE_STORAGE_KEY = "fp_dashboard_disclosure_v2"/);
});
