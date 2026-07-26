import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const salesPlanApi = () => readFileSync(new URL("../app/api/sales-plan/route.ts", import.meta.url), "utf8");
const plApi = () => readFileSync(new URL("../app/api/planning/pl/route.ts", import.meta.url), "utf8");
const stateStore = () => readFileSync(new URL("../lib/planning/stateStore.ts", import.meta.url), "utf8");

test("planning_state store reads updated_at and writes through compare-and-swap guards", () => {
  const source = stateStore();

  assert.match(source, /\.select\("data, updated_at"\)/);
  assert.match(source, /\.insert\(\{ year, data, updated_at: updatedAt \}\)/);
  assert.match(source, /error\.code === "23505"/);
  assert.match(source, /\.update\(\{ data, updated_at: updatedAt \}\)/);
  assert.match(source, /\.eq\("updated_at", snapshot\.updatedAt\)/);
  assert.match(source, /\.is\("updated_at", null\)/);
  assert.match(source, /if \(!updatedRow\) return \{ ok: false, conflict: true \};/);
});

test("sales-plan saves retry by reloading latest planning_state instead of upserting stale JSON", () => {
  const source = salesPlanApi();

  assert.doesNotMatch(source, /\.upsert\(/);
  assert.match(source, /const PLANNING_STATE_SAVE_ATTEMPTS = 3;/);
  assert.match(source, /saveEnvelopeWithRetry/);
  assert.match(source, /readEnvelope\(snapshot\.data, context\)/);
  assert.match(source, /writePlanningStateSnapshot\(db, context\.year, snapshot, merged, updatedAt\)/);
  assert.match(source, /snapshot = await loadPlanningState<StoredState>\(db, context\.year\);/);
});

test("legacy P&L planning saves also retry through the shared planning_state store", () => {
  const source = plApi();

  assert.doesNotMatch(source, /\.upsert\(/);
  assert.match(source, /savePlanningBlockWithRetry/);
  assert.match(source, /mergePlanningBlock\(snapshot\.data, cabinetId, block\)/);
  assert.match(source, /writePlanningStateSnapshot\(db, year, snapshot, data, new Date\(\)\.toISOString\(\)\)/);
  assert.match(source, /snapshot = await loadPlanningState<PlanningState>\(db, year\);/);
});
