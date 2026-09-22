import assert from "node:assert/strict";
import test from "node:test";
import { describeWbReportFetchError } from "../lib/wb/reportPagination";

test("WB report error keeps the underlying connect timeout", () => {
  const cause = Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" });
  const error = new Error("fetch failed", { cause });

  assert.equal(
    describeWbReportFetchError(error),
    "fetch failed: Connect Timeout Error · UND_ERR_CONNECT_TIMEOUT",
  );
});

test("WB report error keeps a normal HTTP/network message unchanged", () => {
  assert.equal(describeWbReportFetchError(new Error("WB 429: rate limit")), "WB 429: rate limit");
  assert.equal(describeWbReportFetchError("Ошибка сети WB"), "Ошибка сети WB");
});
