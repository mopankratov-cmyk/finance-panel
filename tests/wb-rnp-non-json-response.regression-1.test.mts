import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readApiResponse } from "../lib/http/readApiResponse";

test("RNP client converts Vercel plain-text platform errors into readable API errors", async () => {
  const body = await readApiResponse<{ error?: string }>(
    new Response("An error occurred with this application.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
    "РНП",
  );

  assert.match(body.error ?? "", /РНП вернул техническую ошибку HTTP 500/);
  assert.doesNotMatch(body.error ?? "", /Unexpected token/);
});

test("RNP client still reads normal JSON API responses", async () => {
  const body = await readApiResponse<{ ok?: boolean; error?: string }>(
    Response.json({ ok: true }),
    "РНП",
  );

  assert.deepEqual(body, { ok: true });
});

test("WB RNP page does not parse table and plan responses with raw response.json", () => {
  const source = readFileSync(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");
  assert.match(source, /readApiResponse<RnpTable>\(response, "РНП"\)/);
  assert.match(source, /readApiResponse<\{ plan\?: Record<string, Record<string, number>>; error\?: string \}>\(response, "План РНП"\)/);
  assert.doesNotMatch(source, /const body = \\(await response\\.json\\(\\)\\) as RnpTable/);
});

test("WB RNP page keeps a same-scope last-good table when refresh times out", () => {
  const source = readFileSync(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");
  assert.match(source, /const activeData = dataKey === currentDataKey \? data : null;/);
  assert.match(source, /error && activeData/);
  assert.doesNotMatch(source, /setLoading\(true\);\s*setData\(null\);\s*setError\(null\);/);
});

test("WB RNP table API wraps cabinet resolution and access checks in JSON error handling", () => {
  const source = readFileSync(new URL("../app/api/rnp/[shop]/table/route.ts", import.meta.url), "utf8");
  assert.match(source, /try \{\n    const \{ shop \} = await ctx\.params;/);
  assert.match(source, /const \{ cabinetId, label \} = await resolveShopCabinet\(shop\);/);
  assert.match(source, /return NextResponse\.json\(\n      \{ error: error instanceof Error \? error\.message : "Не удалось собрать РНП" \},\n      \{ status: 500 \},\n    \);/);
});
