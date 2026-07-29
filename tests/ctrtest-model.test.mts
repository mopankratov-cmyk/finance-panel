import assert from "node:assert/strict";
import test from "node:test";
import { chooseCtrWinner, ctrSnapshotDelta, ctrVariantScore, ctrWinnerExplanation, normalizeCtrCreatePayload } from "../lib/ctrtest/model";

test("CTR test creation requires one cabinet and unique HTTPS variants", () => {
  const valid = normalizeCtrCreatePayload({
    cabinetId: "00000000-0000-4000-8000-000000000001",
    nmId: 123,
    testType: "ctr",
    intervalMin: 60,
    impressionsPerRound: 350,
    targetImpressions: 1000,
    spendCapRub: 5000,
    variants: [{ imageUrl: "https://example.com/a.webp" }, { imageUrl: "https://example.com/b.webp" }],
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.ok && valid.value.variants[0].isBaseline, true);
  assert.equal(normalizeCtrCreatePayload({ cabinetId: "all" }).ok, false);
  assert.equal(normalizeCtrCreatePayload({
    cabinetId: "x", nmId: 1, testType: "ctr", intervalMin: 60, impressionsPerRound: 350, targetImpressions: 1000, spendCapRub: 5000,
    variants: [{ imageUrl: "http://example.com/a" }, { imageUrl: "https://example.com/b" }],
  }).ok, false);
});

test("metric deltas fail closed when provider counters are corrected backwards", () => {
  const delta = ctrSnapshotDelta(
    { impressions: 1000, clicks: 50, spend: 500, opens: 300, carts: 30, orders: 10 },
    { impressions: 900, clicks: 55, spend: 450, opens: 330, carts: 38, orders: 12 },
  );
  assert.equal(delta.impressions, 0);
  assert.equal(delta.clicks, 5);
  assert.equal(delta.spend, 0);
  assert.equal(delta.corrected, true);
});

test("winner uses the metric of the selected test type and explains the result", () => {
  const variants = [
    { id: 1, position: 0, label: "A", isBaseline: true, impressions: 1000, clicks: 30, spend: 300, opens: 500, carts: 50, orders: 10, roundsCount: 1, roundsWon: 0 },
    { id: 2, position: 1, label: "B", isBaseline: false, impressions: 900, clicks: 45, spend: 350, opens: 400, carts: 32, orders: 16, roundsCount: 1, roundsWon: 1 },
  ];
  assert.equal(ctrVariantScore("ctr", variants[1]), 5);
  assert.equal(chooseCtrWinner("ctr", variants)?.id, 2);
  assert.equal(chooseCtrWinner("cr", variants)?.id, 1);
  assert.match(ctrWinnerExplanation("video", variants[1], variants[0]), /WB API не отдаёт просмотры видео/);
});
