import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeOzonCacheRequest,
  OZON_COCKPIT_CACHE_VERSION,
  ozonCockpitCacheIdentity,
  ozonCockpitCacheTag,
} from "../lib/ozon/cockpitCache";
import { describeOzonScope, type OzonCabinetAccess } from "../lib/ozon/cabinet";

const base = {
  view: "overview" as const,
  scope: { mode: "all" as const, label: "Все кабинеты", cabinetIds: ["cab-b", "cab-a", "cab-a"] },
  days: 14,
  taxPct: 7,
};

test("Ozon snapshot identity is stable for an equivalent cabinet scope", () => {
  const normalized = normalizeOzonCacheRequest(base);
  assert.deepEqual(normalized.scope.cabinetIds, ["cab-a", "cab-b"]);
  assert.equal(
    ozonCockpitCacheIdentity(base),
    ozonCockpitCacheIdentity({ ...base, scope: { ...base.scope, cabinetIds: ["cab-a", "cab-b"] } }),
  );
});

test("Ozon snapshot identity isolates screens and cabinet sets", () => {
  const overview = ozonCockpitCacheIdentity(base);
  const sales = ozonCockpitCacheIdentity({ ...base, view: "sales" });
  const single = ozonCockpitCacheIdentity({
    ...base,
    scope: { mode: "single", label: "Первый", cabinetIds: ["cab-a"] },
  });
  assert.notEqual(overview, sales);
  assert.notEqual(overview, single);
});

test("версия снимка обесценивает и кэш инстанса, и общий снимок в базе", () => {
  assert.match(OZON_COCKPIT_CACHE_VERSION, /^v\d+$/);
  // Пин на конкретную версию быстро устаревает и ловит не тот дефект. Важно
  // другое: версия обязана входить в КЛЮЧ СНИМКА В БАЗЕ. Когда её там не было,
  // смена логики данных обесценивала только кэш процесса, и пользователь до
  // часа смотрел на нулевую рекламу уже после починки источника.
  const source = readFileSync(new URL("../lib/ozon/cockpitCache.ts", import.meta.url), "utf8");
  assert.match(source, /const sharedKey = `\$\{OZON_COCKPIT_CACHE_VERSION\}:/);
});

test("Ozon snapshot tag is short and contains no cabinet labels", () => {
  const tag = ozonCockpitCacheTag(base);
  assert.match(tag, /^ozon-cockpit:[a-f0-9]{32}$/);
  assert.ok(tag.length < 256);
  assert.equal(tag.includes("Все кабинеты"), false);
});

test("Ozon snapshot descriptor never carries Seller or Performance secrets", () => {
  const cabinet: OzonCabinetAccess = {
    id: "cab-a",
    name: "Первый",
    clientId: "seller-client",
    creds: { clientId: "seller-client", apiKey: "seller-secret" },
    perf: { clientId: "performance-client", secret: "performance-secret" },
  };
  const serialized = ozonCockpitCacheIdentity({
    ...base,
    scope: describeOzonScope({ mode: "single", label: cabinet.name, cabinets: [cabinet] }),
  });
  assert.equal(serialized.includes("seller-secret"), false);
  assert.equal(serialized.includes("performance-secret"), false);
  assert.equal(serialized.includes("seller-client"), false);
  assert.equal(serialized.includes("performance-client"), false);
});
