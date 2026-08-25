import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildWithdrawalPlan, parsePrice, parseReturnedKiz, parseSoldKiz } from "../lib/wb/kizWithdrawal.ts";

const CODE_A = "0104660691960104215mT+XtQEaCHos";
const CODE_B = "0104660691960104215aB1cD2eF3gHi";

const soldRows = [
  ["Номер задания", "Артикул продавца", "Код маркировки", "Цена", "Дата продажи"],
  ["5551449991", "HT-83-35", CODE_A, "1 234,56 ₽", "20.08.2026"],
  ["5551449992", "HT-83-02", CODE_B, "2000", "21.08.2026"],
];

test("выгрузка проданного читается вместе с ценой реализации", () => {
  const result = parseSoldKiz(soldRows);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].price, 1234.56, "цена с пробелами и рублём должна разобраться");
  assert.equal(result.lines[0].soldAt, "2026-08-20");
  assert.equal(result.lines[0].taskId, "5551449991");
  assert.equal(result.withoutPrice, 0);
});

test("строка без кода не теряется молча, а попадает в issues", () => {
  const result = parseSoldKiz([...soldRows, ["5551449993", "NV-01-55", "", "500", "22.08.2026"]]);
  assert.equal(result.lines.length, 2);
  assert.deepEqual(result.issues, [{ line: 4, reason: "нет кода маркировки" }]);
});

test("выгрузка без колонки кода — это ошибка, а не пустой результат", () => {
  assert.throws(() => parseSoldKiz([["Номер задания", "Цена"], ["1", "2"]]), /нет колонки кода маркировки/);
});

test("возвраты берутся ВСЕ, а не только брак", () => {
  // Соседний модуль «КИЗ по брендам» фильтрует по «возврат брака» — там другая
  // задача. Здесь любой вернувшийся товар снова в обороте.
  const result = parseReturnedKiz([
    ["Код маркировки", "Причина", "Дата возврата"],
    [CODE_A, "Возврат брака", "22.08.2026"],
    [CODE_B, "Отказ покупателя", "23.08.2026"],
  ]);
  assert.equal(result.lines.length, 2);
});

test("возвращённое вычитается из списка на вывод", () => {
  const sold = parseSoldKiz(soldRows).lines;
  const returned = parseReturnedKiz([["Код маркировки", "Причина"], [CODE_A, "Отказ покупателя"]]).lines;
  const plan = buildWithdrawalPlan({ sold, returned, alreadySent: new Set(), alreadyReturned: new Set() });
  assert.deepEqual(plan.toWithdraw.map((l) => l.code.code), [CODE_B.slice(0, 31)]);
  assert.equal(plan.excludedByReturn.length, 1);
});

test("отправленный раньше код второй раз не уходит", () => {
  const sold = parseSoldKiz(soldRows).lines;
  const plan = buildWithdrawalPlan({
    sold, returned: [], alreadySent: new Set([CODE_A.slice(0, 31)]), alreadyReturned: new Set(),
  });
  assert.deepEqual(plan.toWithdraw.map((l) => l.code.code), [CODE_B.slice(0, 31)]);
  assert.equal(plan.alreadySent.length, 1);
});

test("возврат после отправки виден отдельно — молча это не исправить", () => {
  // Код уже выведен из оборота, а товар вернулся. Система такое сама не чинит:
  // вернуть код в оборот может только тот, кто его выводил.
  const returned = parseReturnedKiz([["Код маркировки", "Причина"], [CODE_A, "Отказ покупателя"]]).lines;
  const plan = buildWithdrawalPlan({
    sold: [], returned, alreadySent: new Set([CODE_A.slice(0, 31)]), alreadyReturned: new Set(),
  });
  assert.equal(plan.returnedAfterSent.length, 1);
});

test("дубли внутри одной выгрузки считаются, а не задваивают вывод", () => {
  const sold = parseSoldKiz([...soldRows, ["5551449994", "HT-83-35", CODE_A, "1234,56", "20.08.2026"]]).lines;
  const plan = buildWithdrawalPlan({ sold, returned: [], alreadySent: new Set(), alreadyReturned: new Set() });
  assert.equal(plan.duplicates, 1);
  assert.equal(plan.toWithdraw.length, 2);
});

test("цена разбирается из разных написаний, а мусор даёт null, а не ноль", () => {
  assert.equal(parsePrice("1 234,56 ₽"), 1234.56);
  assert.equal(parsePrice("2000"), 2000);
  assert.equal(parsePrice("—"), null, "прочерк не должен превращаться в нулевую цену");
  assert.equal(parsePrice(""), null);
});

test("отчёт WB отдаёт код ровно в том виде, который нужен Честному Знаку", async () => {
  // Проверено на боевых токенах 24.08.2026: excise_short — ровно 31 символ,
  // 01 + GTIN(14) + 21 + серийник(13). Криптохвост в документ вывода не идёт.
  const { parseKizCode } = await import("../lib/wb/kizCodes.ts");
  const fromReport = "0104640655797946215=QeZHoDouLe!";
  assert.equal(fromReport.length, 31);
  const parsed = parseKizCode(fromReport);
  assert.equal(parsed.code, fromReport, "код из отчёта не должен ничего терять при разборе");
  assert.equal(parsed.gtin, "04640655797946");
});

test("экспорт ограничен лимитом документа Честного Знака", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../app/api/warehouse/kiz/export/route.ts", import.meta.url), "utf8");
  assert.match(src, /CHZ_DOC_LIMIT = 30_000/, "больше 30 000 кодов в одном документе ЧЗ не принимает");
});

test("сборщик фильтрует чужие коды товарным контуром кабинета", async () => {
  // У агентского кабинета в отчёте большинство строк не наши: за август
  // «Оптима» вернула 90 470 строк. Вывести из оборота чужой код нельзя.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../app/api/warehouse/kiz/collect/route.ts", import.meta.url), "utf8");
  assert.match(src, /allowsProduct\(scope, row\.nmId\)/);
});

test("сборщик заданий сохраняет дату продажи, иначе срок вывода не начинается", () => {
  const src = readFileSync(new URL("../app/api/warehouse/kiz/tasks/route.ts", import.meta.url), "utf8");
  // Дата выкупа — начало трёхсуточного срока. Без неё код вечно «свежий»:
  // сводка намеренно считает строку без даты не просроченной.
  assert.match(src, /sold_at: sale\.soldAt/, "дата продажи не записывается");
  assert.match(src, /nm_id: sale\.nmId/, "товар не записывается");
  assert.match(src, /article: sale\.article/, "артикул не записывается");
  assert.match(src, /select\("srid, sale_id, price_with_disc, for_pay, date, nm_id"\)/, "товар не запрашивается у продажи");
});

test("добор прежних строк не затирает уже известную дату", () => {
  const src = readFileSync(new URL("../app/api/warehouse/kiz/tasks/route.ts", import.meta.url), "utf8");
  // Запись в реестр идёт через upsert с ignoreDuplicates — существующую строку
  // он не трогает. Значит добор идёт отдельным update, и он обязан быть узким.
  assert.match(src, /\.is\("sold_at", null\)\s*\n\s*\.select\("code"\)/, "добор не ограничен пустыми строками");
  assert.match(src, /BLANK_LIMIT/, "у добора нет потолка");
});

test("сбор файла сужен юрлицом — иначе привязка опаснее, чем её отсутствие", () => {
  // Отметку «отправлено» штатно не откатить: собрать чужие коды в свой документ
  // вывода — ошибка навсегда. Поэтому экспорт обязан фильтровать, а не только экран.
  const src = readFileSync(new URL("../app/api/warehouse/kiz/export/route.ts", import.meta.url), "utf8");
  assert.match(src, /query\.eq\("legal_entity_id", entityId\)/, "экспорт не сужен юрлицом");
  assert.match(src, /resolveEntity\(wanted\)/, "экспорт не проверяет доступ к юрлицу");

  const tab = readFileSync(new URL("../components/warehouse/KizTab.tsx", import.meta.url), "utf8");
  assert.match(tab, /markSent: true, entityId/, "вкладка не передаёт юрлицо в сбор файла");
});

test("полоса дел считает коды своего юрлица", () => {
  const src = readFileSync(new URL("../app/api/warehouse/todo/route.ts", import.meta.url), "utf8");
  const kizLines = src.split("\n").filter((line) => line.includes("kiz_withdrawals"));
  assert.equal(kizLines.length, 2, "ожидались ровно два запроса к реестру");
  for (const line of kizLines) {
    assert.match(line, /legal_entity_id", entityId/, `запрос к реестру не сужен юрлицом: ${line.trim()}`);
  }
});

test("владелец кода — чей товар, а не чей агент", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202608250031_kiz_legal_entity_functions.sql", import.meta.url), "utf8");
  // Правило 1 идёт по товару: код выпущен на товар, у товара есть владелец.
  const byProduct = sql.indexOf("v_by_product = row_count");
  const byCabinet = sql.indexOf("v_by_cabinet = row_count");
  assert.ok(byProduct > 0 && byCabinet > byProduct, "правило по товару должно применяться раньше правила по кабинету");
  // Агентская связь не даёт владения: агент не владеет товаром, значит и кодом.
  assert.match(sql, /where relation = 'own'/, "кабинетное правило не ограничено собственным кабинетом");
  assert.doesNotMatch(sql, /relation = 'agent'/, "агентская связь не должна давать владения");
  // Неразобранное остаётся null, а не приписывается наугад.
  assert.match(sql, /'left', v_left/, "функция не сообщает, сколько кодов осталось без владельца");
});

test("сводка считается в базе, а не вычиткой всего реестра", () => {
  const src = readFileSync(new URL("../app/api/warehouse/kiz/route.ts", import.meta.url), "utf8");
  assert.match(src, /db\.rpc\("kiz_summary", \{ p_entity: entityId \}\)/, "сводка не переехала в базу");
  assert.doesNotMatch(src, /loadAllSupabasePages[\s\S]{0,200}kiz_withdrawals[\s\S]{0,200}status, price, sold_at/, "старая вычитка реестра осталась");
});
