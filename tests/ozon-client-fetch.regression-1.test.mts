import assert from "node:assert/strict";
import test from "node:test";
import { fetchOzonCockpitJson, type OzonFetch } from "../lib/ozon/clientFetch";

// Regression test for QA ISSUE-010: https://finance-panel-two.vercel.app/ozon/sales
test("Ozon cockpit retries one transient transport failure", async () => {
  let calls = 0;
  const request: OzonFetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("Failed to fetch");
    return { ok: true, status: 200, json: async () => ({ orders: 893 }) };
  };

  const result = await fetchOzonCockpitJson<{ orders: number }>(
    "/api/ozon/cockpit?view=sales",
    new AbortController().signal,
    request,
  );
  assert.equal(result.orders, 893);
  assert.equal(calls, 2);
});

test("Ozon cockpit does not repeat an authoritative HTTP error", async () => {
  let calls = 0;
  const request: OzonFetch = async () => {
    calls += 1;
    return { ok: false, status: 403, json: async () => ({ error: "Нет доступа" }) };
  };

  await assert.rejects(
    fetchOzonCockpitJson("/api/ozon/cockpit", new AbortController().signal, request),
    /Нет доступа/,
  );
  assert.equal(calls, 1);
});
