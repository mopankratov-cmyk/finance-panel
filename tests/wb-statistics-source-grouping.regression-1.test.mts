import assert from "node:assert/strict";
import test from "node:test";

import { groupWbStatisticsTargets, wbStatisticsSourceKey, type SyncTarget } from "../lib/sync/cabinets";

const target = (name: string, statisticsSourceKey: string, statsToken: string): SyncTarget => ({
  cabinetId: name,
  name,
  statsToken,
  advertToken: "advert",
  contentToken: "content",
  productScope: { brandFilters: [], allowedNmIds: null },
  statisticsSourceKey,
});

test("virtual WB cabinets of one seller share one statistics request group", () => {
  const groups = groupWbStatisticsTargets([
    target("main", "seller:42", "token-a"),
    target("brand-scope", "seller:42", "token-b"),
    target("other", "seller:77", "token-c"),
  ]);

  assert.deepEqual(groups.map((group) => group.map((item) => item.name)), [
    ["main", "brand-scope"],
    ["other"],
  ]);
});

test("legacy targets without seller metadata are grouped by identical token", () => {
  const base = target("first", "", "shared-token");
  delete base.statisticsSourceKey;
  const sibling = { ...base, cabinetId: "second", name: "second" };
  const other = { ...base, cabinetId: "third", name: "third", statsToken: "other-token" };

  assert.deepEqual(groupWbStatisticsTargets([base, sibling, other]).map((group) => group.length), [2, 1]);
});

test("different JWT tokens from one WB organization share a seller source key", () => {
  const jwt = (payload: Record<string, unknown>, signature: string) => [
    Buffer.from("{}").toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    signature,
  ].join(".");

  assert.equal(
    wbStatisticsSourceKey({ token: jwt({ oid: 250086551, scope: "statistics" }, "one") }),
    wbStatisticsSourceKey({ token: jwt({ oid: 250086551, scope: "analytics" }, "two") }),
  );
});
