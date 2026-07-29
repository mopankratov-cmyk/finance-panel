import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = ["action", "bulk", "bid", "deposit", "cpm-reco"];

test("every advert mutation/read recommendation is cabinet-bound and never uses the global token directly", async () => {
  for (const route of routes) {
    const source = await readFile(new URL(`../app/api/adverts/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /resolveAdvertCabinetContext/);
    assert.doesNotMatch(source, /const WB_ADV_TOKEN = process\.env\.WB_TOKEN_ADVERT/);
  }
});
