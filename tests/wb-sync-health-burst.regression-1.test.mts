import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("WB sync health limits database fan-out to one cabinet at a time", async () => {
  const source = await readFile(new URL("../app/api/wb/sync-health/route.ts", import.meta.url), "utf8");

  assert.match(source, /for \(const cabinet of cabinets\)/);
  assert.doesNotMatch(source, /Promise\.all\(cabinets\.map/);
  assert.match(source, /catch \(error\)[\s\S]*Не удалось прочитать/);
  assert.match(source, /catch \(error\)[\s\S]*Не удалось проверить/);
});
