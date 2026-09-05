import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { needsFinanceHydration } from "../lib/navigation/financeHydration";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * FinanceProvider лежит в КОРНЕВОМ макете и грузил финансовое состояние на
 * каждой странице панели. Замер на проде: 2,7–3,1 с — второй по тяжести запрос
 * на экране воронки WB, где это состояние не читает никто. Роль ниже финансиста
 * получала за эти секунды ещё и отказ: роут открыт директору и финотделу.
 */
test("финансовое состояние грузится только там, где его читают", () => {
  const source = read("../components/providers/FinanceProvider.tsx");
  assert.match(source, /const financeNeeded = needsFinanceHydration\(pathname\);/);
  assert.match(source, /if \(!financeNeeded\) \{/, "на чужом экране запроса быть не должно");
  assert.match(source, /\}, \[financeNeeded\]\);/, "переход на экран финансов обязан поднять загрузку");
  // «Не загружено» ≠ «загружено пустым»: иначе экран финансов показал бы нули.
  assert.match(source, /setHydrated\(false\);/);
});

test("макет и провайдер отвечают на вопрос одним и тем же условием", () => {
  for (const file of ["../components/AppLayout.tsx", "../components/providers/FinanceProvider.tsx"]) {
    assert.match(read(file), /needsFinanceHydration/, file);
  }
  // Кокпиты не ждут финансов — и теперь не платят за них запросом.
  for (const path of ["/wb/rnp", "/wb/funnel", "/ozon/sales", "/warehouse", "/", "/login"]) {
    assert.equal(needsFinanceHydration(path), false, path);
  }
  for (const path of ["/payments", "/calendar", "/loans", "/accounts", "/payroll", "/payments/import"]) {
    assert.equal(needsFinanceHydration(path), true, path);
  }
});
