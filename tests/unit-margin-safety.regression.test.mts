import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseUnitCabinetScope } from "../lib/unit/cabinetScope";
import { isConfiguredCronBearer } from "../lib/unit/cronAuth";
import { parseUnitMoneyQuery } from "../lib/unit/query";

test("unit cron auth requires a configured exact bearer", () => {
  assert.equal(isConfiguredCronBearer("Bearer arbitrary", undefined), false);
  assert.equal(isConfiguredCronBearer("Bearer arbitrary", ""), false);
  assert.equal(isConfiguredCronBearer("Bearer arbitrary", "   "), false);
  assert.equal(isConfiguredCronBearer("Bearer cron-secret", "cron-secret"), true);
  assert.equal(isConfiguredCronBearer("Bearer wrong", "cron-secret"), false);
});

test("unit money controls preserve explicit zero and apply documented defaults", () => {
  assert.deepEqual(parseUnitMoneyQuery(new URLSearchParams()), {
    taxPct: 7,
    ff: 0,
    targetMargin: 25,
  });
  assert.deepEqual(parseUnitMoneyQuery(new URLSearchParams("tax=0&ff=0&margin=0")), {
    taxPct: 0,
    ff: 0,
    targetMargin: 0,
  });
});

for (const query of [
  "tax=-1",
  "tax=101",
  "tax=NaN",
  "tax=Infinity",
  "tax=abc",
  "ff=-1",
  "ff=1000001",
  "ff=Infinity",
  "margin=-1",
  "margin=100",
  "margin=NaN",
]) {
  test(`unit money controls reject ${query}`, () => {
    assert.throws(() => parseUnitMoneyQuery(new URLSearchParams(query)));
  });
}

test("unit money controls reject duplicate singleton parameters", () => {
  assert.throws(() => parseUnitMoneyQuery(new URLSearchParams("tax=7&tax=8")));
  assert.throws(() => parseUnitMoneyQuery(new URLSearchParams("ff=0&ff=1")));
  assert.throws(() => parseUnitMoneyQuery(new URLSearchParams("margin=20&margin=25")));
});

test("unit cabinet scope aggregates only for an absent parameter or exact all", () => {
  assert.deepEqual(parseUnitCabinetScope(null), { aggregate: true, rawCabinet: null });
  assert.deepEqual(parseUnitCabinetScope("all"), { aggregate: true, rawCabinet: null });
  assert.deepEqual(parseUnitCabinetScope("9c820ef1-c268-4db1-a7db-47089c830c88"), {
    aggregate: false,
    rawCabinet: "9c820ef1-c268-4db1-a7db-47089c830c88",
  });

  for (const raw of ["", "ALL", "unknown", "not-a-uuid", "  all  "]) {
    assert.throws(() => parseUnitCabinetScope(raw));
  }
});

test("unit table dual auth and explicit cabinet resolution fail closed before data work", async () => {
  const [route, roles] = await Promise.all([
    readFile(new URL("../app/api/unit/table/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth/roles.ts", import.meta.url), "utf8"),
  ]);
  const handlerIndex = route.indexOf("export async function GET");
  const cronIndex = route.indexOf("checkCronAuth(req)", handlerIndex);
  const guardIndex = route.indexOf('requireApiSession(["director", "finance", "manager"])');
  const queryValidationIndex = route.indexOf("parseUnitPeriodQuery(sp)", handlerIndex);
  const queryValidationCatchIndex = route.indexOf("} catch (error) {", queryValidationIndex);
  const dbIndex = route.indexOf("getSupabaseAdmin()", handlerIndex);
  const dbUnavailableIndex = route.indexOf('return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 })', dbIndex);
  const resolveIndex = route.indexOf("resolveShopCabinet(", handlerIndex);
  const exactIndex = route.indexOf("resolved.cabinetId !== cabinetScope.rawCabinet", handlerIndex);
  const notFoundIndex = route.indexOf('return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 })', exactIndex);
  const cabinetAccessIndex = route.indexOf("hasCabinetAccess(", handlerIndex);
  const refreshIndex = route.indexOf('sp.get("refresh")', handlerIndex);

  assert.match(roles, /manager:\s*\[[^\]]*"\/unit"/);
  assert.ok(cronIndex >= 0);
  assert.ok(guardIndex >= 0);
  assert.ok(cronIndex < guardIndex);
  assert.ok(guardIndex < queryValidationIndex);
  assert.ok(queryValidationIndex < queryValidationCatchIndex);
  assert.ok(queryValidationCatchIndex < dbIndex);
  assert.ok(dbIndex < dbUnavailableIndex);
  assert.ok(dbUnavailableIndex < resolveIndex);
  assert.ok(guardIndex < refreshIndex);
  assert.ok(resolveIndex < exactIndex);
  assert.ok(exactIndex < notFoundIndex);
  assert.ok(exactIndex < cabinetAccessIndex);
  assert.ok(cabinetAccessIndex < refreshIndex);
  assert.match(route, /if \(!isCron\)\s*\{\s*const gate = await requireApiSession\(\["director", "finance", "manager"\]\)/);
  assert.match(route, /const p_cabinet = cabinetScope\.aggregate \? null : resolved\.cabinetId/);
  assert.doesNotMatch(route, /if \(!db\) return NextResponse\.json\(\{ headers: \[\], rows: \[\], img_urls: \[\] \}\)/);
  assert.match(route, /if \(costsRes\.error\) throw/);
});

test("unit warmup carries CRON_SECRET through internalFetch", async () => {
  const [warmup, internalFetch] = await Promise.all([
    readFile(new URL("../lib/wb/dashboardWarmup.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/internalFetch.ts", import.meta.url), "utf8"),
  ]);

  assert.match(warmup, /internalFetch\(url,\s*\{\s*cache:\s*"no-store"\s*\}\)/);
  assert.match(internalFetch, /headers\.set\("Authorization",\s*`Bearer \$\{secret\}`\)/);
});

test("finance navigation and report-date UI are wired without dishonest fallback", async () => {
  const [tabs, unitPage, opiuPage] = await Promise.all([
    readFile(new URL("../components/FinanceTabs.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/unit/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/opiu/OpiuPage.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(tabs, /\{ href: "\/unit", label: "Маржа по артикулам" \}/);
  assert.match(unitPage, /<FinanceTabs\s*\/>/);
  assert.doesNotMatch(opiuPage, /reportByReportDate\s*\?\?\s*data\?\.report/);
  assert.match(opiuPage, /Данные по дате отчёта пока недоступны: источник не синхронизирован/);
});

test("safe rescue does not introduce prohibited fallback wiring", async () => {
  const files = await Promise.all([
    "../app/api/unit/table/route.ts",
    "../app/unit/page.tsx",
    "../components/FinanceTabs.tsx",
    "../components/opiu/OpiuPage.tsx",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const source = files.join("\n");
  const prohibited = [
    ["fetchSales", "Report"],
    ["fetchWb", "Report"],
    ["docs.google.com/", "spreadsheets"],
    ["mo", "ck"],
  ].map((parts) => parts.join(""));

  for (const signature of prohibited) {
    assert.ok(!source.toLowerCase().includes(signature.toLowerCase()));
  }
});
