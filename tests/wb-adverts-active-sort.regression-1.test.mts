import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compareAdvertCampaigns } from "../lib/adverts/campaignSort";

test("WB adverts auto-sort puts active campaigns above paused campaigns", () => {
  const rows = [
    { id: 11, name: "Paused high spend", enabled: false, spend_today: 9_000, spent_14: 90_000, drr: 5 },
    { id: 12, name: "Active low spend", enabled: true, spend_today: 1, spent_14: 100, drr: 40 },
    { id: 13, name: "Active high spend", enabled: true, spend_today: 500, spent_14: 1_000, drr: 20 },
  ].sort(compareAdvertCampaigns);

  assert.deepEqual(rows.map((row) => row.id), [13, 12, 11]);
});

test("WB adverts sort uses today spend, period spend and DRR inside the same status group", () => {
  const rows = [
    { id: 21, name: "Same spend worse DRR", enabled: true, spend_today: 100, spent_14: 1_000, drr: 30 },
    { id: 22, name: "Same spend better DRR", enabled: true, spend_today: 100, spent_14: 1_000, drr: 10 },
    { id: 23, name: "Bigger today", enabled: true, spend_today: 200, spent_14: 500, drr: 99 },
    { id: 24, name: "Bigger period", enabled: true, spend_today: 100, spent_14: 2_000, drr: 99 },
  ].sort(compareAdvertCampaigns);

  assert.deepEqual(rows.map((row) => row.id), [23, 24, 22, 21]);
});

test("WB adverts page applies automatic active-first campaign sort after filtering", () => {
  const source = readFileSync(new URL("../components/wb/WbAdvertsPage.tsx", import.meta.url), "utf8");
  assert.match(source, /compareAdvertCampaigns\(left\.campaign, right\.campaign\)/);
});
