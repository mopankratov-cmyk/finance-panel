import assert from "node:assert/strict";
import test from "node:test";
import { parseProfileInput } from "../lib/assortment/brandProfiles.ts";
import { briefCsv, csvCell, exportFileName, isCollectionKind, isReplaceReason, type BriefSnapshot } from "../lib/assortment/collections.ts";
import { DecisionInputError, decisionReason, isActionId, isReferenceStatus, reasonLabel } from "../lib/assortment/decisions.ts";
import { extractHtmlProduct, importDedupKey, trustedCanonical } from "../lib/assortment/extract.ts";
import { ImportInputError, importReference } from "../lib/assortment/importer.ts";
import { reasonKey } from "../lib/assortment/learning.ts";
import { hasOwnKey } from "../lib/assortment/own.ts";

/** Граница ТЗ «в модуле нет цен», формулы в CSV, ключи прототипа, доверие к чужим полям страницы (аудит 05.10). */

test("Заметка и название при импорте: цены и деньги не принимаются (как при правке признаков), база не трогается", async () => {
  const untouched = new Proxy({}, { get: () => { throw new Error("база не должна читаться"); } }) as never;
  for (const note of ["цена 120 €", "Стоимость около 5000 ₽", "дорого, 99 USD", "себестоимость низкая", "$50"]) {
    await assert.rejects(() => importReference(untouched, { direction: "bags", url: "https://x.example/p", note }, null), (e: unknown) => e instanceof ImportInputError && /Цены и деньги/.test(e.message), note);
  }
  await assert.rejects(() => importReference(untouched, { direction: "bags", url: "https://x.example/p", title: "Сумка за 99 usd" }, null), ImportInputError);
});

test("Комментарий решения: цены и деньги не принимаются; обычный текст проходит", () => {
  assert.throws(() => decisionReason("rejected", "other", "слишком дорого, 5000 руб"), DecisionInputError);
  assert.throws(() => decisionReason("rejected", "shape", "цена выше рынка"), DecisionInputError);
  assert.throws(() => decisionReason("selected", null, "берём, € 20"), DecisionInputError);
  assert.equal(decisionReason("rejected", "shape", "слишком мягкая"), "shape:слишком мягкая");
  assert.equal(decisionReason("selected", null, "в план на весну"), "в план на весну");
});

test("Профиль бренда: цены и деньги не принимаются ни в одном текстовом поле", () => {
  for (const field of ["audience", "notes", "palette", "sourceRef"] as const) {
    const bad = parseProfileInput("jackets", { version: 1, [field]: "ориентир по цене 5000 ₽" });
    assert.ok("error" in bad && /цены и деньги/.test(bad.error), field);
  }
  const ok = parseProfileInput("jackets", { version: 1, audience: "Женщины 30–45", notes: "базовые вещи", palette: "чёрный, беж", sourceRef: "решение владельца 05.10" });
  assert.ok("patch" in ok);
});

test("CSV для Excel: текст, начинающийся с = + - @ табуляцией или CR, не исполнится формулой; обычное не меняется", () => {
  for (const value of ["=HYPERLINK(\"http://evil\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) assert.match(csvCell(value), /^"'/, JSON.stringify(value));
  assert.equal(csvCell("Хобо Mini"), '"Хобо Mini"');
  assert.equal(csvCell('Сумка "Нова"'), '"Сумка ""Нова"""');
  assert.equal(csvCell("A-1"), '"A-1"', "дефис внутри текста не трогаем");
  assert.equal(csvCell("—"), '"—"');
  const snapshot = { items: [{ position: "Модель 1", title: '=HYPERLINK("http://evil","клик")', brand: "@Brand", article: "-1", sourceUrl: "https://x.example", idea: null, details: [], differences: "", questions: "", seasonFit: "", observed: [], missing: [], nextStep: null }] } as unknown as BriefSnapshot;
  const csv = briefCsv(snapshot);
  assert.match(csv, /;"'=HYPERLINK\(""http:\/\/evil"",""клик""\)";"'@Brand";"'-1";/);
});

test("Имя файла выгрузки: ASCII, без кавычек и переводов строк, не длиннее 40 знаков периода; кириллица и пустое не роняют", () => {
  assert.equal(exportFileName("2026-11", 3), "zadanie-2026-11-v3");
  assert.equal(exportFileName(null, 1), "zadanie-podborka-v1");
  for (const period of ["Осень 2026", 'a"b\r\nc', "../../etc", "ёёё", "x".repeat(200)]) {
    const name = exportFileName(period, 2);
    assert.match(name, /^zadanie-[A-Za-z0-9._-]+-v2$/, period);
    assert.ok(name.length <= 60);
  }
});

test("Ключи прототипа не проходят проверки «известная причина / вид / статус / действие»", () => {
  for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    assert.equal(isActionId(key), false, key);
    assert.equal(isReferenceStatus(key), false, key);
    assert.equal(isReplaceReason(key), false, key);
    assert.equal(isCollectionKind(key), false, key);
    assert.equal(reasonKey(key), null, key);
    assert.equal(reasonKey(`replaced:${key}`), null, key);
    assert.throws(() => decisionReason("rejected", key, null), DecisionInputError, key);
    assert.equal(reasonLabel(key), key, "неизвестная причина показывается как есть, без ярлыка из прототипа");
  }
  assert.equal(isActionId("rejected"), true);
  assert.equal(isCollectionKind("bags_month"), true);
  assert.equal(reasonKey("shape:слишком мягкая"), "shape");
  assert.equal(hasOwnKey({ a: 1 }, "a"), true);
  assert.equal(hasOwnKey({ a: 1 }, "toString"), false);
});

test("Каноническая ссылка страницы: только http(s) и тот же сайт; javascript:, чужой домен и мусор отбрасываются, поддомен витрины — свой", () => {
  const page = "https://eu.brand.com/gb/p/1";
  assert.equal(trustedCanonical("/gb/p/1?x=1", page), "https://eu.brand.com/gb/p/1?x=1");
  assert.equal(trustedCanonical("https://www.brand.com/p/1", page), "https://www.brand.com/p/1", "тот же базовый домен");
  assert.equal(trustedCanonical("javascript:alert(document.cookie)", page), null);
  assert.equal(trustedCanonical("data:text/html,x", page), null);
  assert.equal(trustedCanonical("https://evil.example/phish", page), null);
  assert.equal(trustedCanonical("http://[bad", page), null);
  const html = '<link rel="canonical" href="javascript:alert(1)"><meta property="og:title" content="X">';
  assert.equal(extractHtmlProduct(html, page).canonicalUrl, null);
  assert.equal(extractHtmlProduct('<link rel="canonical" href="/p/1">', page).canonicalUrl, "https://eu.brand.com/p/1");
});

test("Ключ находки при импорте: у сайта вне паспорта артикул включает домен — одинаковый sku у двух сайтов не склеивает находки; у источника из паспорта ключ прежний", () => {
  const a = importDedupKey(null, "", "SKU1", "https://shop-a.com/p/1", "https://shop-a.com/p/1");
  const b = importDedupKey(null, "", "SKU1", "https://shop-b.com/p/9", "https://shop-b.com/p/9");
  assert.notEqual(a, b);
  assert.equal(a, "manual||shop-a.com:SKU1");
  assert.equal(importDedupKey(null, "", "SKU1", "https://eu.shop-a.com/p/2", "https://eu.shop-a.com/p/2"), a, "витрины одного сайта — одна находка");
  assert.equal(importDedupKey("S024", "GB", "123", "https://x.com/p", "https://x.com/p"), "S024|GB|123", "паспортный источник — как раньше");
  assert.equal(importDedupKey(null, "", null, "https://shop-a.com/p/1", "https://shop-a.com/p/1"), "manual||https://shop-a.com/p/1", "артикула нет — адрес");
});
