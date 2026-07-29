import assert from "node:assert/strict";
import test from "node:test";
import { indexOzonOfferIdsBySku, resolveOzonOfferId } from "../lib/ozon/productIdentity";

// Regression test for QA ISSUE-003: https://finance-panel-two.vercel.app/ozon/stocks
test("stock rows recover offer ids when the Ozon catalogue mapping is incomplete", () => {
  const stockOfferIds = indexOzonOfferIdsBySku([
    { sku: 1_871_577_408, article: "CLR00913" },
    { sku: 1_611_555_719, article: "CLR00711" },
  ]);

  assert.equal(resolveOzonOfferId("1871577408", {}, stockOfferIds), "CLR00913");
  assert.equal(resolveOzonOfferId("1611555719", {}, stockOfferIds), "CLR00711");
});

test("catalogue offer ids remain authoritative when both sources are available", () => {
  const stockOfferIds = indexOzonOfferIdsBySku([{ sku: 42, article: "OLD-OFFER" }]);
  assert.equal(resolveOzonOfferId(42, { "42": "CURRENT-OFFER" }, stockOfferIds), "CURRENT-OFFER");
});
