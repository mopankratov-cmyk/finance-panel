import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { discoverCabinetProducts, type SyncTarget } from "../lib/sync/cabinets";
import {
  allowsBrand,
  allowsNm,
  allowsProduct,
  cabinetBrandFilters,
  normalizeBrandFilters,
  normalizeWbBrand,
  type WbProductScope,
} from "../lib/wb/productScope";

test("normalizeWbBrand ignores case, spaces and separators", () => {
  assert.equal(normalizeWbBrand(" Rio Box "), "riobox");
  assert.equal(normalizeWbBrand("NORVIA"), "norvia");
  assert.deepEqual(normalizeBrandFilters(["NORVIA", "Rio Box", "rio-box"]), ["norvia", "riobox"]);
});

test("unscoped cabinet allows every product", () => {
  const scope: WbProductScope = { brandFilters: [], allowedNmIds: null };
  assert.equal(allowsProduct(scope, 999, "Чужой бренд"), true);
});

test("scoped cabinet prefers an exact normalized brand over a stale nmID", () => {
  const scope: WbProductScope = {
    brandFilters: normalizeBrandFilters(["NORVIA", "RIOBOX"]),
    allowedNmIds: [1244157227, 1239272673],
  };
  assert.equal(allowsNm(scope, 1244157227), true);
  assert.equal(allowsProduct(scope, 555, "Rio Box"), true);
  assert.equal(allowsBrand(scope, "SIBERION"), false);
  assert.equal(allowsProduct(scope, 555, "SIBERION"), false);
  assert.equal(allowsProduct(scope, 1244157227, "SIBERION"), false);
  assert.equal(allowsProduct(scope, 1244157227, undefined), true);
});

test("empty allowlist remains restricted to configured brands", () => {
  const scope: WbProductScope = {
    brandFilters: normalizeBrandFilters(["NORVIA", "RIOBOX"]),
    allowedNmIds: [],
  };
  assert.equal(allowsProduct(scope, 1, undefined), false);
  assert.equal(allowsProduct(scope, 1, "NORVIA"), true);
});

test("Optima is always restricted to NORVIA and RIOBOX", () => {
  assert.deepEqual(cabinetBrandFilters("Optima", []), ["norvia", "riobox"]);
  assert.deepEqual(cabinetBrandFilters("ООО Оптима", ["SIBERION"]), ["norvia", "riobox"]);
});

test("Retail Family is always restricted to NORVIA", () => {
  assert.deepEqual(cabinetBrandFilters("Retail Family", []), ["norvia"]);
  assert.deepEqual(cabinetBrandFilters("ИП Филиппов · Retail Family", ["BEAUTY ME"]), ["norvia"]);
});

test("product discovery bootstraps every allowed card for an empty scoped cabinet", async () => {
  const target: SyncTarget = {
    cabinetId: "retail-family",
    name: "Retail Family",
    statsToken: "statistics",
    advertToken: "advert",
    contentToken: "content",
    productScope: { brandFilters: ["norvia"], allowedNmIds: [] },
  };
  const firstPage = [
    { nmID: 101, vendorCode: "NV-01", brand: "NORVIA" },
    ...Array.from({ length: 99 }, (_, index) => ({ nmID: 1_000 + index, vendorCode: `OTHER-${index}`, brand: "OTHER" })),
  ];
  const pages = [firstPage, [{ nmID: 102, vendorCode: "NV-02", brand: " Norvia " }]];
  const saved: number[] = [];

  const discovered = await discoverCabinetProducts(target, {
    fetchImpl: async () => new Response(JSON.stringify({ cards: pages.shift() ?? [], cursor: { updatedAt: "2026-07-14", nmID: 102 } })),
    persistProducts: async (current, products) => {
      saved.push(...products.map((product) => product.nm_id));
      current.productScope.allowedNmIds = [...new Set([...(current.productScope.allowedNmIds ?? []), ...saved])];
    },
  });

  assert.equal(discovered, 2);
  assert.deepEqual(saved, [101, 102]);
  assert.deepEqual(target.productScope.allowedNmIds, [101, 102]);
});

test("product discovery does not turn an unrestricted cabinet into an allowlist", async () => {
  let requested = false;
  const discovered = await discoverCabinetProducts({
    cabinetId: "clerIn",
    name: "CLERIN",
    statsToken: "statistics",
    advertToken: "advert",
    contentToken: "content",
    productScope: { brandFilters: [], allowedNmIds: null },
  }, {
    fetchImpl: async () => {
      requested = true;
      return new Response(JSON.stringify({ cards: [] }));
    },
  });

  assert.equal(discovered, 0);
  assert.equal(requested, false);
});

test("RNP report migration uses the seller price before SPP", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260714_wb_rnp_pre_spp_and_retail_scope.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /coalesce\(w\.total_price,\s*0\)\s*\*\s*\(1\s*-\s*coalesce\(w\.discount_percent,\s*0\)\s*\/\s*100\.0\)/i);
  assert.match(migration, /coalesce\(w\.price_with_disc,\s*w\.finished_price,\s*0\)/i);
  assert.equal((migration.match(/sale_id like 'S%'/g) ?? []).length, 3);
  assert.doesNotMatch(migration, /sum\(coalesce\(w\.finished_price,\s*w\.total_price\)\)/i);
});

test("other cabinets keep their configured brand scope", () => {
  assert.deepEqual(cabinetBrandFilters("CLERIN", ["CLERIN", "ENOUGH"]), ["clerin", "enough"]);
});
