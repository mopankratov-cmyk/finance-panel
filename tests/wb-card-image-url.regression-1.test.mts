import assert from "node:assert/strict";
import { test } from "node:test";
import { wbCardImageBasketCandidates, wbCardImageUrl } from "../lib/wb/cardImage";

test("WB image URL uses observed basket for new high-volume RIOBOX cards", () => {
  const url = wbCardImageUrl(1_239_272_680);

  assert.match(url, /^https:\/\/basket-44\.wbbasket\.ru\/vol12392\/part1239272\/1239272680\/images\/c246x328\/1\.webp$/);
});

test("WB image URL keeps existing working basket for older cards", () => {
  const url = wbCardImageUrl(898_248_409);

  assert.match(url, /^https:\/\/basket-39\.wbbasket\.ru\/vol8982\/part898248\/898248409\/images\/c246x328\/1\.webp$/);
});

test("WB image fallback candidates try the observed basket before the stale estimate", () => {
  const candidates = wbCardImageBasketCandidates(1_239_272_680);

  assert.ok(candidates.includes(44));
  assert.ok(candidates.includes(50));
  assert.ok(candidates.indexOf(44) < candidates.indexOf(50));
});
