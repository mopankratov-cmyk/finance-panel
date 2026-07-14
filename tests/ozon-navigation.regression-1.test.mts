import assert from "node:assert/strict";
import test from "node:test";
import { withOzonCabinetScope } from "../lib/ozon/navigation";

// Regression test for QA ISSUE-005: https://finance-panel-two.vercel.app/ozon?cabinet=all
test("Ozon navigation carries the selected cabinet to every dashboard link", () => {
  assert.equal(
    withOzonCabinetScope("/ozon/stocks", "cabinet-1933484"),
    "/ozon/stocks?cabinet=cabinet-1933484",
  );
  assert.equal(
    withOzonCabinetScope("/ozon/sales?days=14", "group:7"),
    "/ozon/sales?days=14&cabinet=group%3A7",
  );
});

test("changing cabinet replaces only the cabinet query parameter", () => {
  assert.equal(
    withOzonCabinetScope("/ozon?days=30&cabinet=all#top", "cabinet-cosmos"),
    "/ozon?days=30&cabinet=cabinet-cosmos#top",
  );
});
