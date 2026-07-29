import assert from "node:assert/strict";
import test from "node:test";
import { createLatestRequestGuard } from "../lib/unit/latestRequest";

test("late completion from an old cabinet scope cannot replace the newest response", async () => {
  const guard = createLatestRequestGuard();
  const rendered: string[] = [];
  let releaseOld!: () => void;
  const oldReady = new Promise<void>((resolve) => { releaseOld = resolve; });

  const oldGeneration = guard.begin();
  const oldRequest = oldReady.then(() => {
    if (guard.isCurrent(oldGeneration)) rendered.push("old");
  });
  const newGeneration = guard.begin();
  if (guard.isCurrent(newGeneration)) rendered.push("new");
  releaseOld();
  await oldRequest;

  assert.deepEqual(rendered, ["new"]);
});

test("cleanup invalidates an in-flight generation even if abort delivery is late", () => {
  const guard = createLatestRequestGuard();
  const generation = guard.begin();
  assert.equal(guard.isCurrent(generation), true);
  guard.invalidate(generation);
  assert.equal(guard.isCurrent(generation), false);
});
