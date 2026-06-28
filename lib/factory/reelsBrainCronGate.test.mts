import assert from "node:assert/strict";
import test from "node:test";
import { reelsBrainTaskForCronTick } from "./reelsBrainCronGate";

function atMinute(minute: number) {
  return new Date(Date.UTC(2026, 5, 28, 5, minute, 0));
}

test("reels brain piggybacks on graph cron only on selected minutes", () => {
  assert.equal(reelsBrainTaskForCronTick(atMinute(0)), "bulk");
  assert.equal(reelsBrainTaskForCronTick(atMinute(2)), "analyze");
  assert.equal(reelsBrainTaskForCronTick(atMinute(3)), "analyze");
  assert.equal(reelsBrainTaskForCronTick(atMinute(6)), "analyze");
  assert.equal(reelsBrainTaskForCronTick(atMinute(7)), "analyze");
  assert.equal(reelsBrainTaskForCronTick(atMinute(10)), null);
  assert.equal(reelsBrainTaskForCronTick(atMinute(12)), "analyze");
  assert.equal(reelsBrainTaskForCronTick(atMinute(16)), "analyze");
  assert.equal(reelsBrainTaskForCronTick(atMinute(58)), null);
});
