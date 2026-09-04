import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../../app/api/opiu/mp/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/pnl/page.tsx", import.meta.url), "utf8");

const cached = readFileSync(new URL("./wbCachedFinance.ts", import.meta.url), "utf8");

test("возвраты уменьшают выручку и комиссии WB, а не только копятся в отдельном поле", () => {
  assert.match(cached, /const sign = isReturn\(row\) \? -1 : 1;/);
  assert.match(cached, /revenueBeforeSpp \+= sign \* amount;/);
  assert.match(cached, /commission \+= sign \* amount \* pct \/ 100;/);
  assert.match(page, /за вычетом возвратов/);
});

test("несчитанные статьи WB не выдаются за ноль", () => {
  assert.doesNotMatch(route, /logistics:\s*0,/);
  assert.doesNotMatch(route, /storage:\s*0,/);
  assert.doesNotMatch(route, /penalty:\s*0,/);
  assert.match(route, /notComputed:\s*\[/);
  assert.match(page, /notComputed/);
  assert.doesNotMatch(page, /\+ соинвест, как принято/);
});
