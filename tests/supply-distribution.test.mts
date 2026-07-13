import test from "node:test";
import assert from "node:assert/strict";
import { allocateByWarehouse, normalizeDistributionSettingsPayload, withoutClosedWarehouses } from "../lib/supplies/distribution";

test("distribution rejects scenarios whose warehouse shares do not total 100 percent", () => {
  const result = normalizeDistributionSettingsPayload({ cabinetId: "cab-1", warehouses: [{ name: "Коледино", pct: 60 }, { name: "Казань", pct: 30 }], excludedNmIds: [], minBatch: 30, palletLiters: 1230 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /100%/);
});

test("largest remainder allocation preserves every unit", () => {
  assert.deepEqual(allocateByWarehouse(7, [{ name: "A", pct: 33.33 }, { name: "B", pct: 33.33 }, { name: "C", pct: 33.34 }]), [2, 2, 3]);
  assert.equal(allocateByWarehouse(101, [{ name: "A", pct: 55 }, { name: "B", pct: 45 }]).reduce((sum, value) => sum + value, 0), 101);
});

test("closed warehouses are zeroed and open shares are rebalanced to 100 percent", () => {
  const result = withoutClosedWarehouses([{ name: "A", pct: 50 }, { name: "B", pct: 30 }, { name: "C", pct: 20 }], new Set(["A"]));
  assert.deepEqual(result, [{ name: "A", pct: 0 }, { name: "B", pct: 60 }, { name: "C", pct: 40 }]);
  assert.equal(result.reduce((sum, row) => sum + row.pct, 0), 100);
});
