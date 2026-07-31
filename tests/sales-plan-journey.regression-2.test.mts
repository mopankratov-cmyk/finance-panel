import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = () => readFileSync(new URL("../components/planning/SalesPlanPage.tsx", import.meta.url), "utf8");
const fact = () => readFileSync(new URL("../components/planning/SalesPlanFactView.tsx", import.meta.url), "utf8");
const api = () => readFileSync(new URL("../app/api/sales-plan/route.ts", import.meta.url), "utf8");

test("planning journey starts with the table close to the first fold", () => {
  const source = page();

  assert.match(source, /const \[basisOpen, setBasisOpen\] = useState\(false\);/);
  assert.match(source, /<details className="group rounded-xl border border-slate-200 bg-white" aria-label="История плана">/);
});

test("empty approved and plan-fact states return the employee to the working plan", () => {
  const pageSource = page();
  const factSource = fact();

  assert.match(pageSource, /Версия ещё не утверждена/);
  assert.match(pageSource, /Открыть черновик/);
  assert.match(factSource, /onOpenPlan: \(\) => void/);
  assert.match(factSource, />Открыть план<\/button>/);
  assert.match(pageSource, /\{canWrite && mode === "edit" \? !plan \?/);
});

test("selected month must contain orders before submission or approval", () => {
  const pageSource = page();
  const apiSource = api();

  assert.match(pageSource, /validateSalesPlanMonth\(plan, activeMonth\)/);
  assert.match(apiSource, /validateSalesPlanMonth\(current, monthKey\)/);
  assert.match(apiSource, /action === "submit" \? validateSalesPlanMonth\(incoming, monthKey\) : \[\]/);
});
