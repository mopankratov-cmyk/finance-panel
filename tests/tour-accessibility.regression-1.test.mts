import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("launcher tour close control has an accessible name", async () => {
  const source = await readFile(new URL("../components/ui/Tour.tsx", import.meta.url), "utf8");

  assert.match(source, /aria-label="Закрыть подсказку"/);
  assert.match(source, /<button type="button"/);
});
