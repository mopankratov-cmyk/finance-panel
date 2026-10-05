import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CTR_MIN_CAMPAIGN_SPEND,
  buildCtrDayPick,
  ctrOfPick,
  ctrPaymentModel,
  ctrPickFromWire,
  ctrPickModel,
  ctrPickToWire,
  pickCtrCampaign,
} from "../lib/wb/ctrCampaignPick.ts";
import { buildWbFunnelDayMetrics } from "../lib/wb/funnelMetrics.ts";
import { CTR_MIN_VIEWS } from "../lib/wb/ctrQuality.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * CTR считается по одной кампании, а не по смеси.
 *
 * Колонка CTR в воронке складывала все кампании дня в одну долю. Живая сверка
 * за 14 дней (12.09.2026): ЕРК 4,48%, CPM 4,32%, CPC 3,77% — три разные шкалы,
 * и в 31,5% клеток с показами их складывали. Число отвечало не «как работает
 * обложка», а «какой смесью кампаний крутили товар».
 *
 * 05.10.2026 владелец: «CTR нужен на всех РК». До этого ЕРК из расчёта
 * исключалась, и у кабинета, где вся реклама — ЕРК (Retail Family), CTR по дням
 * не было вовсе. Теперь ЕРК — полноправный вид кампании: у неё свой слот, свой
 * вариант фильтра и подпись в клетке; смесь внутри артикула по-прежнему
 * исключена — в клетке одна кампания.
 */

test("ЕРК опознаётся по типу ставки, а не по модели оплаты", () => {
  // Ровно та ловушка, из-за которой правило «берём только cpc и cpm» его бы
  // пропустило: в карточке WB у ЕРК написано payment_type: "cpm", и отличает
  // его единственное поле — bid_type: "unified".
  assert.equal(ctrPaymentModel({ bid_type: "unified", payment_type: "cpm", placement_search: true }), "erk");
  assert.equal(ctrPaymentModel({ bid_type: "manual", payment_type: "cpm", placement_search: true }), "cpm");
  assert.equal(ctrPaymentModel({ bid_type: "manual", payment_type: "cpc", placement_shelf: true }), "cpc");
  // Кампания, о которой WB молчит: завершённая или удалённая. Принять её за
  // CPM значило бы догадаться, а догадка попадёт в число как факт.
  assert.equal(ctrPaymentModel({}), null);
  assert.equal(ctrPaymentModel(null), null);
});

test("ЕРК в расчёте: единственная кампания дня даёт CTR, а не прочерк", () => {
  // Retail Family 01.10.2026: «ЕС - 755558105» — 34 005 показов, 6 166 ₽. Раньше
  // клетка была пустой, хотя это и есть вся реклама артикула.
  const pick = buildCtrDayPick(
    [{ advertId: 1, views: 10_000, clicks: 500, spent: 5_000 }],
    () => "erk",
  );
  assert.equal(pickCtrCampaign(pick, "any")?.advertId, 1);
  assert.equal(ctrOfPick(pick, "any"), 5);
  assert.equal(ctrPickModel(pick, "any"), "erk", "в клетке подписан вид — ЕРК");
  assert.equal(pick.dropped, 0);
  // Фильтры CPC и CPM ЕРК не подмешивают: столбец остаётся одной шкалой.
  assert.equal(pickCtrCampaign(pick, "cpc"), null);
  assert.equal(pickCtrCampaign(pick, "cpm"), null);
  assert.equal(ctrOfPick(pick, "erk"), 5);
  // Ниже порога расхода ЕРК — такая же «не рабочая», как любая другая.
  const idle = buildCtrDayPick([{ advertId: 1, views: 900, clicks: 40, spent: 60 }], () => "erk");
  assert.equal(pickCtrCampaign(idle, "any"), null);
  assert.equal(idle.dropped, 1);
});

test("«Любой»: из параллельных берётся та, что потратила больше, ЕРК наравне с остальными", () => {
  const rows = [
    { advertId: 1, views: 10_000, clicks: 800, spent: 6_000 },
    { advertId: 2, views: 10_000, clicks: 200, spent: 900 },
    { advertId: 3, views: 4_000, clicks: 100, spent: 700 },
  ];
  const kind = (advertId: number) => (advertId === 1 ? "erk" : advertId === 2 ? "cpm" : "cpc") as "erk" | "cpm" | "cpc";
  const pick = buildCtrDayPick(rows, kind);
  // Деньги шли в ЕРК — она и рабочая; CPM с 900 ₽ её не перебивает.
  assert.equal(pickCtrCampaign(pick, "any")?.advertId, 1);
  assert.equal(ctrPickModel(pick, "any"), "erk");
  assert.equal(pickCtrCampaign(pick, "cpm")?.advertId, 2);
  assert.equal(pickCtrCampaign(pick, "cpc")?.advertId, 3);
  assert.equal(pickCtrCampaign(pick, "erk")?.advertId, 1);
  assert.equal(pick.dropped, 0, "каждая кампания — лучшая своего вида, отбрасывать нечего");
  // Две ЕРК: берётся потратившая больше, вторая — отброшена.
  const two = buildCtrDayPick(
    [{ advertId: 1, views: 5_000, clicks: 50, spent: 400 }, { advertId: 2, views: 9_000, clicks: 90, spent: 900 }],
    () => "erk",
  );
  assert.equal(pickCtrCampaign(two, "erk")?.advertId, 2);
  assert.equal(two.dropped, 1);
  // Ничья по расходу: порядок видов стабилен — CPM, затем CPC, затем ЕРК.
  const tie = buildCtrDayPick(
    [{ advertId: 1, views: 5_000, clicks: 50, spent: 500 }, { advertId: 2, views: 5_000, clicks: 50, spent: 500 }, { advertId: 3, views: 5_000, clicks: 50, spent: 500 }],
    (advertId) => (advertId === 1 ? "erk" : advertId === 2 ? "cpc" : "cpm"),
  );
  assert.equal(ctrPickModel(tie, "any"), "cpm");
});

test("из параллельных берём ту, что потратила больше", () => {
  // Решение владельца: на рабочую кампанию шли деньги, остальные доживали.
  const pick = buildCtrDayPick([
    { advertId: 1, views: 5_000, clicks: 100, spent: 900 },
    { advertId: 2, views: 8_000, clicks: 500, spent: 300 },
  ], () => "cpm");
  assert.equal(pickCtrCampaign(pick, "any")?.advertId, 1);
  assert.equal(pick.dropped, 1);
  // Не «у кого больше показов»: у второй их больше, и она не выбрана.
  assert.equal(ctrOfPick(pick, "any"), 2);
});

test("кампания ниже порога расхода рабочей не считается", () => {
  const pick = buildCtrDayPick([
    { advertId: 1, views: 4_000, clicks: 200, spent: CTR_MIN_CAMPAIGN_SPEND - 1 },
  ], () => "cpm");
  assert.equal(ctrOfPick(pick, "any"), null);
  assert.equal(pick.dropped, 1);
  // Ровно на пороге — работала.
  const atLimit = buildCtrDayPick([
    { advertId: 1, views: 4_000, clicks: 200, spent: CTR_MIN_CAMPAIGN_SPEND },
  ], () => "cpm");
  assert.equal(ctrOfPick(atLimit, "any"), 5);
});

test("порог расхода и порог показов отвечают на разные вопросы", () => {
  // Кампания потратила достаточно, но показов мало: доля клика всё равно
  // ничего не значит. Один порог другой не заменяет.
  const pick = buildCtrDayPick([
    { advertId: 1, views: CTR_MIN_VIEWS - 1, clicks: 10, spent: 5_000 },
  ], () => "cpm");
  assert.equal(pickCtrCampaign(pick, "any")?.advertId, 1);
  assert.equal(ctrOfPick(pick, "any"), null);
});

test("пустая строка кампании — не отброшенный кандидат", () => {
  // Товар числился в кампании, но она его в этот день не крутила. Считать это
  // отбраковкой значило бы пугать человека числом отброшенных на ровном месте.
  const pick = buildCtrDayPick([
    { advertId: 1, views: 0, clicks: 0, spent: 0 },
    { advertId: 2, views: 4_000, clicks: 200, spent: 900 },
  ], () => "cpm");
  assert.equal(pick.dropped, 0);
  assert.equal(pickCtrCampaign(pick, "any")?.advertId, 2);
});

test("фильтр по виду размещения приводит столбец к одной шкале", () => {
  // Правило убирает смешение внутри артикула, но между артикулами CPM и CPC
  // так и остались бы на разных шкалах — сравнивая их взглядом, человек
  // сравнивал бы вид кампании, а не обложку.
  const pick = buildCtrDayPick([
    { advertId: 1, views: 10_000, clicks: 400, spent: 900 },
    { advertId: 2, views: 10_000, clicks: 300, spent: 500 },
  ], (advertId) => (advertId === 1 ? "cpm" : "cpc"));
  assert.equal(ctrOfPick(pick, "any"), 4);
  assert.equal(ctrOfPick(pick, "cpm"), 4);
  assert.equal(ctrOfPick(pick, "cpc"), 3);
  assert.equal(ctrPickModel(pick, "any"), "cpm");
  assert.equal(ctrPickModel(pick, "cpc"), "cpc");
  // Вида нет вовсе — прочерк, а не подмена соседним видом.
  const onlyCpm = buildCtrDayPick([{ advertId: 1, views: 10_000, clicks: 400, spent: 900 }], () => "cpm");
  assert.equal(ctrOfPick(onlyCpm, "cpc"), null);
});

test("при равном расходе выбор не мечется между видами", () => {
  // Ничья должна решаться одинаково при каждом пересчёте, иначе одна и та же
  // клетка показывала бы разные числа при перезагрузке.
  const pick = buildCtrDayPick([
    { advertId: 1, views: 1_000, clicks: 40, spent: 500 },
    { advertId: 2, views: 1_000, clicks: 30, spent: 500 },
  ], (advertId) => (advertId === 1 ? "cpc" : "cpm"));
  assert.equal(pickCtrCampaign(pick, "any")?.advertId, 2);
  assert.equal(pickCtrCampaign(pick, "any")?.advertId, 2);
});

test("выбор между видами при «ничьей» одинаков на сервере и после округления для экрана", () => {
  // CPM 149,6 ₽ и ЕРК 150,4 ₽: по дробным побеждает ЕРК, а после округления до
  // целых обе по 150 — и ничья уходит к CPM. Окно разбора (сервер, дробные) и
  // клетка (экран, целые) выбирали разные кампании с разным CTR.
  const rows = [
    { advertId: 1, views: 10_000, clicks: 400, spent: 149.6 },
    { advertId: 2, views: 10_000, clicks: 600, spent: 150.4 },
  ];
  const pick = buildCtrDayPick(rows, (advertId) => (advertId === 1 ? "cpm" : "erk"));
  const onScreen = ctrPickFromWire(ctrPickToWire(pick));
  assert.equal(pickCtrCampaign(pick, "any")?.advertId, pickCtrCampaign(onScreen, "any")?.advertId);
  assert.equal(ctrPickModel(pick, "any"), ctrPickModel(onScreen, "any"));
  assert.equal(ctrOfPick(pick, "any"), ctrOfPick(onScreen, "any"));
  // Внутри вида округление выбор не портит: 149,6 против 149,4 — побеждает первая.
  const same = buildCtrDayPick(
    [{ advertId: 1, views: 5_000, clicks: 50, spent: 149.4 }, { advertId: 2, views: 5_000, clicks: 80, spent: 149.6 }],
    () => "cpm",
  );
  assert.equal(pickCtrCampaign(same, "cpm")?.advertId, 2);
});

test("окно разбора выбирает ту же кампанию, что и клетка: фильтр «Вид размещения» доезжает до маршрута", () => {
  const route = read("../app/api/wb/ctr-breakdown/route.ts");
  assert.match(route, /rawModel === "cpc" \|\| rawModel === "cpm" \|\| rawModel === "erk" \? rawModel : "any"/);
  assert.match(route, /pickCtrCampaign\(pick, filter\)/);
  assert.match(route, /ctr: ctrOfPick\(pick, filter\)/);
  assert.doesNotMatch(route, /pickCtrCampaign\(pick, "any"\)/, "жёсткий «Любой» убран");
  assert.match(route, /filter !== "any" && model !== filter\s*\?\s*"filtered"/, "кампании другого вида помечены, а не «меньше расход»");
  const popup = read("../components/wb/WbCtrDayPopup.tsx");
  assert.match(popup, /&model=\$\{model\}/);
  assert.match(popup, /\[cabinetId, nmId, date, model\]/, "смена фильтра перезапрашивает разбор");
  const ui = read("../components/wb/WbFunnelPage.tsx");
  assert.match(ui, /model=\{ctrModel\}/);
});

test("под фильтром вида клетка без разбивки по кампаниям пуста, а не показывает смесь шкал", () => {
  const ui = read("../components/wb/WbFunnelPage.tsx");
  assert.match(ui, /const noBreakdownUnderFilter = isCtr && !pick && ctrModel !== "any";/);
  assert.match(ui, /noBreakdownUnderFilter \? null : cell\?\.\[metric\]/);
  // Подсказка про «отброшена ЕРК» убрана: ЕРК отбрасывается только как нерабочая или уступившая своему виду.
  assert.doesNotMatch(ui, /ЕРК, неразмеченные/);
  assert.match(ui, /уступили кампании того же вида/);
});

test("компактная форма переживает дорогу до экрана без потерь", () => {
  const pick = buildCtrDayPick([
    { advertId: 77, views: 9_000, clicks: 360, spent: 1_234.56 },
    { advertId: 88, views: 500, clicks: 20, spent: 50 },
  ], () => "cpm");
  const restored = ctrPickFromWire(ctrPickToWire(pick));
  assert.equal(ctrOfPick(restored, "any"), ctrOfPick(pick, "any"));
  assert.equal(restored?.cpm?.advertId, 77);
  assert.equal(restored?.dropped, 1);
  assert.equal(ctrPickFromWire(null), null);
});

test("ЕРК едет до экрана четвёртым элементом, а снимок прежней формы читается без неё", () => {
  const pick = buildCtrDayPick([
    { advertId: 5, views: 34_005, clicks: 1_094, spent: 6_165.58 },
    { advertId: 6, views: 2_000, clicks: 40, spent: 150 },
  ], (advertId) => (advertId === 5 ? "erk" : "cpm"));
  const wire = ctrPickToWire(pick);
  assert.deepEqual(wire[3], [5, 34_005, 1_094, 6_166]);
  assert.equal(wire[0], null);
  const restored = ctrPickFromWire(wire);
  assert.equal(restored?.erk?.advertId, 5);
  assert.equal(ctrPickModel(restored, "any"), "erk");
  // Индексы 0–2 не менялись: снимок кэша до 05.10.2026 — без четвёртого элемента.
  const legacy = ctrPickFromWire([null, [6, 2_000, 40, 150], 2]);
  assert.equal(legacy?.erk, null);
  assert.equal(legacy?.cpm?.advertId, 6);
  assert.equal(legacy?.dropped, 2);
  assert.equal(ctrPickModel(legacy, "any"), "cpm");
});

test("воронка считает CTR по выбранной кампании, а расход оставляет суммой", () => {
  // Деньги потрачены и показы случились — из них вычитать нечего. А CTR
  // относится к рекламе конкретного вида, и смешивать шкалы в одну долю нельзя.
  const { metrics, ctrPicks } = buildWbFunnelDayMetrics(
    [{ nm_id: 5, date: "2026-09-10", open_card: 400, add_to_cart: 40, orders: 8, orders_sum: 10_000 }],
    [{ nm_id: 5, date: "2026-09-10", views: 20_000, clicks: 1_000, spent: 1_200 }],
    {
      rows: [
        { nm_id: 5, date: "2026-09-10", views: 10_000, clicks: 800, spent: 300, advert_id: 1 },
        { nm_id: 5, date: "2026-09-10", views: 10_000, clicks: 200, spent: 900, advert_id: 2 },
      ],
      modelOf: (advertId) => (advertId === 1 ? "erk" : "cpm"),
    },
  );
  const cell = metrics[5]["2026-09-10"];
  assert.equal(cell.views, 20_000);
  assert.equal(cell.advert_sum, 1_200);
  // Сумма дала бы 5% — смесью шкал. По рабочей кампании (потратила больше)
  // честные 2%; ЕРК с 300 ₽ не перебила CPM с 900 ₽, но осталась в своём слоте.
  assert.equal(cell.ctr, 2);
  assert.equal(ctrPicks[5]["2026-09-10"][2], 0, "обе кампании — лучшие своего вида, отбрасывать нечего");
  assert.deepEqual(ctrPicks[5]["2026-09-10"][3], [1, 10_000, 800, 300], "ЕРК доезжает до экрана отдельным слотом");
});

test("без разметки кампаний воронка считает по-старому, а не пустеет", () => {
  // Код выкладывается раньше, чем прогреется снимок, и в этот промежуток экран
  // обязан показывать прежние числа, а не строку прочерков.
  const { metrics, ctrPicks } = buildWbFunnelDayMetrics(
    [{ nm_id: 5, date: "2026-09-10", open_card: 400, add_to_cart: 40, orders: 8, orders_sum: 10_000 }],
    [{ nm_id: 5, date: "2026-09-10", views: 10_000, clicks: 500, spent: 300 }],
  );
  assert.equal(metrics[5]["2026-09-10"].ctr, 5);
  assert.deepEqual(ctrPicks, {});
});

test("воронка берёт рекламу по кампаниям, иначе правило не на чем применять", () => {
  const route = read("../app/api/design/day-metrics/route.ts");
  assert.match(route, /from\("wb_advert_nm_campaign_daily"\)/);
  assert.match(route, /advert_id/);
  // Суммы остаются за витриной по артикулам: по-кампанийный слой в семь раз
  // толще, и читать его ради уже посчитанного значило бы платить всемеро.
  assert.match(route, /from\("wb_advert_nm_daily"\)/);
  assert.match(route, /\.or\("views\.gt\.0,clicks\.gt\.0,spent\.gt\.0"\)/);
  // Разметка обязана доехать: без bid_type ЕРК неотличим от CPM.
  assert.match(route, /select\("advert_id, bid_type, payment_type/);
  // Снимок старой схемы переиспользовать нельзя: схема 4 считала CTR суммой, а
  // схема 5 не знала ЕРК — клетки кабинета на одних ЕРК остались бы пустыми.
  assert.match(route, /schema: 6/);
});

test("экран показывает, по какой кампании посчитано число", () => {
  // Цифра без пометки обманет снова: в столбце показов сумма всех кампаний, а
  // доля клика — одной.
  const ui = read("../components/wb/WbFunnelPage.tsx");
  assert.match(ui, /CTR_MODEL_LABEL\[pickModel\]/);
  assert.match(ui, /Отброшено кампаний/);
  // Пустая клетка называет настоящую причину, а не выдуманную: «мало показов» —
  // только когда кампания выбрана.
  assert.match(ui, /chosen && тонкийЗамер \? `Меньше/);
  assert.doesNotMatch(ui, /ни одна не потратила/);
  // ЕРК — вариант фильтра наравне с CPM и CPC; прежнее «ЕРК исключён» убрано.
  assert.match(ui, /\{ value: "erk", label: "ЕРК"/);
  assert.doesNotMatch(ui, /ЕРК из расчёта исключён/);
  assert.match(ui, /включая ЕРК/);
  assert.match(ui, /Вид размещения/);
  assert.match(ui, /ctr_model/);
});

test("разбор по кампаниям считает тем же правилом, что и клетка", () => {
  // Иначе окно спорит с числом, которое взялось объяснять.
  const route = read("../app/api/wb/ctr-breakdown/route.ts");
  assert.match(route, /buildCtrDayPick\(/);
  assert.match(route, /chosen: chosenCampaign/);
  const popup = read("../components/wb/WbCtrDayPopup.tsx");
  assert.match(popup, /в расчёте/);
  assert.match(popup, /EXCLUDED_LABEL/);
});

test("словарь видов размещения в панели один", () => {
  // Свой разбор «cpc или cpm» разошёлся бы с журналом РК на первой же правке:
  // там уже учтены ручные переопределения, старые строки синка и тип ставки.
  const source = read("../lib/wb/ctrCampaignPick.ts");
  assert.match(source, /wbAdvertBlock\(advert\)/);
  assert.doesNotMatch(source, /bid_search_rub/, "второй разбор ставок — копия словаря advertBlocks");
});
