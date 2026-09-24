import assert from "node:assert/strict";
import test from "node:test";
import { collectOzonAccrualPages } from "./api.ts";

test("stops after the first page when there is only one page", async () => {
  let calls = 0;
  const result = await collectOzonAccrualPages(async () => {
    calls += 1;
    return { accruals: [{ id: 1 }], lastId: undefined };
  });
  assert.deepEqual(result.accruals, [{ id: 1 }]);
  assert.equal(result.truncated, false);
  assert.equal(calls, 1);
});

test("follows last_id across pages until the page comes back empty", async () => {
  const pages = [
    { accruals: [{ id: 1 }], lastId: "A" },
    { accruals: [{ id: 2 }], lastId: "B" },
    { accruals: [], lastId: undefined },
  ];
  let call = 0;
  const requestedLastIds: (string | undefined)[] = [];
  const result = await collectOzonAccrualPages(async (lastId) => {
    requestedLastIds.push(lastId);
    return pages[call++];
  });
  assert.deepEqual(result.accruals, [{ id: 1 }, { id: 2 }]);
  assert.equal(result.truncated, false);
  assert.deepEqual(requestedLastIds, [undefined, "A", "B"]);
});

test("stops on the second request when Ozon echoes the same last_id back, without duplicating the page", () => {
  return (async () => {
    // Reproduces the reported bug: Ozon ignores the last_id we sent and keeps
    // returning the same page with the same last_id forever. Must detect this
    // on the very next response, not one request later.
    let calls = 0;
    const result = await collectOzonAccrualPages(async () => {
      calls += 1;
      return { accruals: [{ id: 1 }, { id: 2 }], lastId: "X" };
    });
    assert.deepEqual(result.accruals, [{ id: 1 }, { id: 2 }]);
    assert.equal(result.truncated, false, "an echoed last_id is a normal end-of-data signal, not truncation");
    assert.equal(calls, 2, "should stop after the echo is detected, not loop to the page cap");
  })();
});

test("flags truncated when the page cap is hit while last_id keeps changing", async () => {
  let calls = 0;
  const result = await collectOzonAccrualPages(async () => {
    calls += 1;
    return { accruals: [{ id: calls }], lastId: `page-${calls}` };
  }, 5);
  assert.equal(calls, 5);
  assert.equal(result.accruals.length, 5);
  assert.equal(result.truncated, true, "hitting the page cap with more data still coming must be flagged");
});
