import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildFunnelMetrics } from "../lib/rnp/buildTable";

test("RNP keeps product-card transitions separate from advertising traffic", () => {
  const metrics = buildFunnelMetrics(
    ["2026-07-12", "2026-07-13"],
    "2026-07-13",
    new Map([["2026-07-12", 22]]),
    new Map([["2026-07-12", 9]]),
    new Map([
      ["2026-07-12", 4_686],
      ["2026-07-13", 5_314],
    ]),
    new Map([
      ["2026-07-12", 713],
      ["2026-07-13", 802],
    ]),
    { adverts: "2026-07-12", funnel: "2026-07-13" },
  );

  const productTraffic = metrics.find((metric) => metric.field === "open_card");
  const adViews = metrics.find((metric) => metric.field === "views");
  const adClicks = metrics.find((metric) => metric.field === "clicks");

  assert.equal(productTraffic?.label, "Переходы в карточку");
  assert.equal(productTraffic?.source, "WB Воронка");
  assert.deepEqual(productTraffic?.daily, [4_686, 5_314]);
  assert.equal(productTraffic?.total, 10_000);
  assert.equal(adViews?.label, "Рекламные показы");
  assert.equal(adViews?.total, 22);
  assert.equal(adClicks?.label, "Рекламные клики");
  assert.equal(adClicks?.total, 9);
});

test("advert stats include completed campaigns and rotate every hour", () => {
  const source = readFileSync(new URL("../app/api/sync/advert-stats/route.ts", import.meta.url), "utf8");

  assert.match(source, /\.in\("status", \[7, 9, 11\]\)/);
  assert.match(source, /\.order\("advert_id", \{ ascending: true \}\)/);
  assert.match(source, /Math\.floor\(Date\.now\(\) \/ 3_600_000\)/);
  assert.match(source, /export const maxDuration = 300/);
  assert.match(source, /MAX_BATCHES_PER_CABINET_PER_RUN = 4/);
  assert.match(source, /claimWbSyncJob\(db, t\.cabinetId, "advert-stats", 6 \* 60\)/);
  assert.match(source, /fallbackWaitMs: 20_000/);
  assert.match(source, /isWbAdvertRateLimit\(res\.status, message\)/);
  assert.match(source, /"rate_limited"/);
  assert.match(source, /errors\.length \? \(errors\.join\("; "\) \+ note\)\.trim\(\) : null/);
  assert.doesNotMatch(source, /dayOfYear/);
});
