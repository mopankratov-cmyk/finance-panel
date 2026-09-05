import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: ISSUE-004 — Recharts warned about width(-1)/height(-1) on dashboard charts.
// Found by /qa on 2026-07-17
// Report: .gstack/qa-reports/qa-report-finance-panel-two-vercel-app-2026-07-17.md
test("Ozon overview chart has a stable measured container", async () => {
  const source = await readFile(new URL("../components/ozon/OzonOverviewPage.tsx", import.meta.url), "utf8");

  assertMeasuredContainer(source);
});

test("WB market chart has a stable measured container", async () => {
  const source = await readFile(new URL("../components/wb/WbMarketPage.tsx", import.meta.url), "utf8");

  assertMeasuredContainer(source);
});

// Recharts требует от обёртки трёх вещей сразу: заданной высоты, права
// сжиматься (`min-w-0`) и полной ширины. Порядок слов в строке значения не
// имеет — а вот принадлежность ОДНОМУ элементу имеет: искать три класса по
// всему файлу нельзя, `min-w-0` и `w-full` есть в нём и на других узлах, и
// такая проверка прошла бы даже с потерянной обёрткой.
function assertMeasuredContainer(source: string) {
  const wrapper = source
    .match(/className="[^"]*"/g)
    ?.find((value) => value.includes("min-h-[280px]"));
  assert.ok(wrapper, "обёртка графика с заданной высотой min-h-[280px] исчезла");
  assert.match(wrapper, /min-w-0/, "обёртка графика потеряла право сжиматься");
  assert.match(wrapper, /w-full/, "обёртка графика потеряла полную ширину");
  assert.match(source, /<ResponsiveContainer width="100%" height=\{280\} minWidth=\{0\}>/);
}
