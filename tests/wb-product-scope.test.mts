import test from "node:test";
import assert from "node:assert/strict";
import {
  allowsBrand,
  allowsNm,
  allowsProduct,
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

test("scoped cabinet allows exact nmID or exact normalized brand", () => {
  const scope: WbProductScope = {
    brandFilters: normalizeBrandFilters(["NORVIA", "RIOBOX"]),
    allowedNmIds: [1244157227, 1239272673],
  };
  assert.equal(allowsNm(scope, 1244157227), true);
  assert.equal(allowsProduct(scope, 555, "Rio Box"), true);
  assert.equal(allowsBrand(scope, "SIBERION"), false);
  assert.equal(allowsProduct(scope, 555, "SIBERION"), false);
});

test("empty allowlist remains restricted to configured brands", () => {
  const scope: WbProductScope = {
    brandFilters: normalizeBrandFilters(["NORVIA", "RIOBOX"]),
    allowedNmIds: [],
  };
  assert.equal(allowsProduct(scope, 1, undefined), false);
  assert.equal(allowsProduct(scope, 1, "NORVIA"), true);
});
