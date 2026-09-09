import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ozonTotalsFromBalance, splitOzonPeriodByMonth } from "../lib/ozon/api.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * 8 сентября 2026 Ozon выключил /v3/finance/transaction/{totals,list}: оба
 * отвечают 400 «obsolete method cannot be used». Панель переехала на
 * /v1/finance/balance — единственный живой метод, который принимает
 * произвольный период (cash-flow-statement умеет только половины месяца).
 */

// Ответ снят с боевого кабинета за 01–02.09.2026 и урезан до нужных полей.
const LIVE = {
  total: { accrued: { value: 628962.34, currency_code: "RUB" }, payments: [{ value: -560842.33 }] },
  cashflows: {
    sales: { amount: { value: 1318217 }, fee: { value: -301053.66 } },
    returns: { amount: { value: -5249 }, fee: { value: 1156.27 } },
    services: [
      { name: "logistics", amount: { value: -111883.84 } },
      { name: "cross_docking", amount: { value: -14864.7 } },
      { name: "reverse_logistics", amount: { value: -11222.75 } },
      { name: "delivery_to_handover_place_by_ozon", amount: { value: -7125 } },
      { name: "courier_client_reinvoice", amount: { value: -26886.07 } },
      { name: "partner_returns_cancellations_processing", amount: { value: -5580 } },
      { name: "packing_by_agents", amount: { value: -3720 } },
      { name: "packing_package", amount: { value: -1860 } },
      { name: "temporary_placement_agent", amount: { value: -324 } },
      { name: "booking_space_and_staff_for_partial_shipment", amount: { value: -1000 } },
      { name: "processing_of_identified_surpluses_in_shipment", amount: { value: -1005 } },
      { name: "acquiring", amount: { value: -12110.36 } },
      { name: "pay_per_click", amount: { value: -125541.03 } },
      { name: "promotion_with_cost_per_order", amount: { value: -54714.35 } },
      { name: "external_promotion", amount: { value: -2803 } },
      { name: "product_disposal", amount: { value: -750 } },
      { name: "product_placement_in_ozon_warehouses", amount: { value: -437.68 } },
      { name: "stock_insurance", amount: { value: -2280.49 } },
    ],
  },
};

test("формула «к выплате» сходится с собственным итогом Ozon", () => {
  // Лучшая доступная проверка мэппинга: у баланса есть свой `total.accrued`,
  // и панель считает выплату по своей формуле из разложенных полей. Если
  // раскладка верна, две цифры обязаны совпасть до рубля.
  const t = ozonTotalsFromBalance(LIVE);
  const abs = Math.abs;
  const payout = t.accruals_for_sale
    - abs(t.sale_commission) - abs(t.processing_and_delivery) - abs(t.services_amount)
    - abs(t.refunds_and_cancellations) - abs(t.others_amount) + t.compensation_amount;
  assert.equal(Math.round(payout), Math.round(LIVE.total.accrued.value));
});

test("неизвестная услуга попадает в удержания, а не пропадает", () => {
  // Ozon добавляет услуги, и список доставки в коде — не полный перечень
  // мира. Услуга с незнакомым именем обязана лечь в «услуги»: потерянная
  // строка молча уменьшает удержания, то есть завышает прибыль.
  const withNew = { cashflows: { services: [{ name: "новая_услуга_ozon", amount: { value: -1000 } }] } };
  const t = ozonTotalsFromBalance(withNew);
  assert.equal(t.services_amount, -1000);
  assert.equal(t.processing_and_delivery, 0);
});

test("возврат считается вместе с вернувшейся комиссией", () => {
  const t = ozonTotalsFromBalance(LIVE);
  assert.equal(Math.round(t.refunds_and_cancellations * 100) / 100, -4092.73);
});

test("период режется на куски не длиннее месяца", () => {
  // Ozon отвечает 400 «maximum period is one month» — проверено живьём на
  // 92 днях. Куски обязаны покрывать период целиком и не наезжать друг на друга.
  const chunks = splitOzonPeriodByMonth("2026-06-08T00:00:00.000Z", "2026-09-07T23:59:59.999Z");
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0].from, "2026-06-08");
  assert.equal(chunks[chunks.length - 1].to, "2026-09-07");
  for (let i = 1; i < chunks.length; i++) {
    const prevEnd = Date.parse(`${chunks[i - 1].to}T00:00:00Z`);
    const start = Date.parse(`${chunks[i].from}T00:00:00Z`);
    assert.equal(start - prevEnd, 86_400_000, "кусок начинается на следующий день после предыдущего");
  }
  for (const chunk of chunks) {
    const days = (Date.parse(`${chunk.to}T00:00:00Z`) - Date.parse(`${chunk.from}T00:00:00Z`)) / 86_400_000;
    assert.ok(days <= 30, `кусок ${chunk.from}–${chunk.to} длиннее месяца`);
  }
  assert.deepEqual(splitOzonPeriodByMonth("2026-09-02", "2026-09-01"), [], "перевёрнутый период не даёт кусков");
});

test("выключенные методы Ozon больше нигде не вызываются", () => {
  const api = read("../lib/ozon/api.ts");
  // Ищем именно вызовы, а не упоминания: в комментариях мёртвые методы
  // названы намеренно — без них непонятно, почему код такой.
  assert.doesNotMatch(api, /\$\{BASE\}\/v3\/finance\/transaction\/totals/, "метод выключен 08.09.2026");
  assert.doesNotMatch(api, /\$\{BASE\}\/v3\/finance\/transaction\/list/, "метод выключен 08.09.2026");
  assert.match(api, /\$\{BASE\}\/v1\/finance\/balance/, "финансы берутся из живого метода");
  // Проверка ключа не должна зависеть от того, какой отчёт сегодня жив: пока
  // она стучалась в финансы, рабочий ключ нового кабинета объявлялся битым.
  assert.match(api, /export async function validateOzon[\s\S]{0,600}v3\/product\/list/);
});

test("отказ финансов доходит до экрана прочерком, а не нулём", () => {
  const cockpit = read("../lib/ozon/cockpit.ts");
  assert.match(cockpit, /financeAvailable \? financial\.refunds : null/);
  assert.match(cockpit, /financeAvailable \? financial\.deductions : null/);
  assert.match(cockpit, /financeAvailable \? financial\.payout : null/);
  assert.match(cockpit, /finance: financeAvailable \? financial : null/);
  // Сигнал «высокая сумма возвратов» не должен срабатывать на незнании.
  assert.match(cockpit, /if \(financeAvailable && financial\.refunds > 0/);

  const overview = read("../components/ozon/OzonOverviewPage.tsx");
  // Подпись плитки утверждает происхождение цифры — при отказе она обязана
  // меняться вместе со значением.
  assert.match(overview, /Ozon не отдал финансы/);
  assert.doesNotMatch(overview, /detail="Расчёт по транзакциям"/, "подпись обещала транзакции, которых больше нет");
});

test("расход без разнесения по товарам показывается прочерком", () => {
  const cockpit = read("../lib/ozon/cockpit.ts");
  assert.match(cockpit, /const adAllocated = \[\.\.\.adCache\.keys\(\)\]\.some/);
  assert.match(cockpit, /adSpend: adAllocated \? r0\(ad\.spent\) : null/);
  assert.match(cockpit, /drr: adAllocated \? pct\(ad\.spent, entry\.revenue\) : null/);
});

test("дозаполнение истории не выбрасывает уже скачанное", () => {
  // Счётчик задумывался как «заходов подряд без прогресса», а считал любой
  // незавершённый заход. При одиннадцати частях и двух за заход день не
  // закрывался никогда: сброс наступал раньше. Прогресс обязан обнулять счёт.
  const route = read("../app/api/sync/ozon-adverts/route.ts");
  assert.match(route, /const doneBefore = \(saved\?\.report\?\.batches \?\? \[\]\)\.filter\(\(batch\) => batch\.done\)\.length/);
  assert.match(route, /const moved = reordered \|\| doneNow > doneBefore/);
  assert.match(route, /misses: moved \? 0 : misses \+ 1/);
});

test("снимки кокпита с нулями вместо «не знаем» признаны недействительными", () => {
  // Форма summary поменялась внутри кэшируемого загрузчика: без подъёма
  // версии экран получил бы вчерашний снимок и продолжил показывать нули.
  assert.match(read("../lib/ozon/cockpitCache.ts"), /OZON_COCKPIT_CACHE_VERSION = "v8"/);
});
