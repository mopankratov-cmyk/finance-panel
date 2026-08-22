import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const funnel = readFileSync(new URL("../components/wb/WbFunnelPage.tsx", import.meta.url), "utf8");
const warmup = readFileSync(new URL("../lib/wb/dashboardWarmup.ts", import.meta.url), "utf8");
const seoRoute = readFileSync(new URL("../app/api/seo/skus/route.ts", import.meta.url), "utf8");

test("Воронка применяет ручной порядок артикулов из РНП", () => {
  // Пересохранение порядка в РНП «не работало» в Воронке, потому что Воронка
  // его вообще не читала — теперь перечисленные артикулы идут первыми.
  assert.match(funnel, /useCabinetSkuOrder\(hasExactCabinet \? cabinetId : null\)/);
  assert.match(funnel, /sortByCustomSkuOrder\(base, \(sku\) => sku\.nm, orderIndex\)/);
});

test("прогрев греет все три окна воронки, дополнительные — без пересборки", () => {
  // Грелось только окно 7 дней: «Вчера» и «30 дней» пользователь всегда
  // собирал сам. refresh=1 на дополнительных окнах устроил бы полный ребилд
  // каждый час — достаточно собрать холодный снимок нового дня один раз.
  assert.match(warmup, /coldOnly\(1\)/);
  assert.match(warmup, /coldOnly\(30\)/);
  assert.match(warmup, /url\.searchParams\.delete\("refresh"\)/);
});

test("seo/skus умеет ?timings=1 и грузит страницы пачками", () => {
  assert.match(seoRoute, /params\.get\("timings"\) === "1"/);
  assert.match(seoRoute, /concurrency: 4/);
  assert.match(seoRoute, /timed\("feedbacks"/);
  assert.match(seoRoute, /timed\("totals_rpc"/);
});
