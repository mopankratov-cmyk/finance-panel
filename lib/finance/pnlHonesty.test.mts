import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../../app/api/opiu/mp/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/pnl/page.tsx", import.meta.url), "utf8");
const monthlyPage = readFileSync(new URL("../../components/opiu/MonthlyOpiuPage.tsx", import.meta.url), "utf8");
const monthlyModel = readFileSync(new URL("../opiu/monthlyStatement.ts", import.meta.url), "utf8");

const wbActual = readFileSync(new URL("../opiu/monthlyWbActual.ts", import.meta.url), "utf8");

test("месячный ОПиУ использует сверенный финансовый отчёт WB", () => {
  assert.match(route, /loadOpiuSalePeriod/);
  assert.match(route, /monthlyWbActualFromOpiu/);
  assert.match(wbActual, /revenue_without_spp/);
  assert.match(monthlyModel, /revenue_before_spp/);
});

test("несчитанные статьи WB не выдаются за ноль", () => {
  assert.match(wbActual, /requiredTotal\(report, "logistics"\)/);
  assert.match(wbActual, /requiredTotal\(report, "warehouse"\)/);
  assert.match(wbActual, /requiredTotal\(report, "penalties"\)/);
  assert.doesNotMatch(route, /logistics:\s*null/);
  assert.match(monthlyPage, /По известным статьям/);
  assert.doesNotMatch(monthlyPage, /\+ соинвест, как принято/);
});

test("общий ОПиУ выбирается только по календарному месяцу без налога в интерфейсе", () => {
  assert.match(route, /sp\.get\("month"\)/);
  assert.match(route, /const from = `\$\{month\}-01`/);
  assert.doesNotMatch(route, /sp\.get\("weeks"\)/);
  assert.match(monthlyPage, /type="month"/);
  assert.doesNotMatch(monthlyPage, /\[2, 4, 8\]/);
  assert.doesNotMatch(monthlyPage, />Налог</);
  assert.doesNotMatch(monthlyPage, /ОПиУ маркетплейсов/);
  assert.doesNotMatch(monthlyPage, /CabinetSwitcher|useActiveCabinet/);
});

test("недоступный WB-кабинет не блокирует весь месячный ОПиУ", () => {
  assert.match(route, /accessibleBrandIds/);
  assert.match(route, /Promise\.resolve\(\{ error: "Нет доступа к кабинетам WB из состава ОПиУ" \}\)/);
  assert.doesNotMatch(route, /return NextResponse\.json\(\{ error: "Нет доступа к WB-кабинету" \}, \{ status: 403 \}\)/);
});
