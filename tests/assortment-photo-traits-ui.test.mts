import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccuracySummary, fieldHiddenReason, PhotoTraits, sourceGapsNote, TraitsSection } from "../components/assortment/PhotoTraits.tsx";
import { fieldAccuracy } from "../lib/assortment/attributeVerdicts.ts";
import { sourceGaps, sourceShares, type CatalogHead, type PhotoTraitsReport, type SourceShare } from "../lib/assortment/catalogAi.ts";

/**
 * Блок «Признаки по фото» статическим рендером (renderToStaticMarkup, без новых зависимостей): подпись «каких источников в долях нет
 * или мало», точность текущей модели ИИ отдельно от прежних, причины скрытия долей. Ф1, 06.10. Телефон и iPad — одна колонка до md,
 * пояснения видимым текстом, а не всплывающей подсказкой (docs/MOBILE-ADAPTATION.md).
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const flat = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const share = (sourceId: string, name: string, models: number, eligible: number, analyzed: number, ru = false): SourceShare => ({ sourceId, name, models, eligible, analyzed, ru });
const report = (over: Partial<PhotoTraitsReport> = {}): PhotoTraitsReport => ({
  direction: "bags", analyzed: 120, legacy: 0, catalog: 130, coverage: 92.3, sourcesInAverage: 0, basis: "raw", averageCoverage: 0,
  fields: [
    { key: "silhouette", label: "Силуэт", visible: 60, notVisible: 0, values: [{ value: "тоут", models: 40, share: 66.7, avgSourceShare: null, sources: 3 }], other: null },
    { key: "proportions", label: "Пропорции", visible: 60, notVisible: 0, values: [{ value: "средняя", models: 30, share: 50, avgSourceShare: null, sources: 3 }], other: null },
  ],
  ...over,
});

test("Подпись под долями: каких источников нет (сайт РФ, нет ссылок на фото, ещё не разобран) и каких мало — видимым текстом, даже когда охват выше 90%", () => {
  const sources = [
    share("S001", "Zara", 187, 62, 60),
    share("S040", "Rains", 50, 50, 48),
    share("S128", "Lime", 300, 0, 0, true),
    share("S050", "Pompa", 40, 0, 0),
    share("S060", "Askent", 30, 30, 0),
    share("S070", "Sela", 12, 12, 6),
  ];
  const html = renderToStaticMarkup(createElement(TraitsSection, { report: report({ sources }), accuracy: null }));
  const t = flat(html);
  assert.doesNotMatch(t, /предварительно/, "охват 92% — пометки «предварительно» нет, а подпись про источники есть");
  assert.match(t, /Каких источников в долях нет или мало: нет — Lime \(сайт РФ — ориентир, ИИ его не разбирает\), Pompa \(нет ссылок на фото\), Askent \(ещё не разобран, с фото 30\); мало — Zara: 60 из 187, у 125 нет ссылок на фото, Sela: 6 из 12\. Доли описывают остальные источники, а не весь рынок раздела\./);
  assert.doesNotMatch(t, /Rains:/, "Rains представлен: 48 из 50");
  assert.doesNotMatch(html, /title="Каких источников/, "пояснение — видимым текстом, а не подсказкой при наведении (на телефоне её нет)");
  const full = flat(renderToStaticMarkup(createElement(TraitsSection, { report: report({ sources: [share("S040", "Rains", 50, 50, 48)] }), accuracy: null })));
  assert.doesNotMatch(full, /Каких источников/, "все представлены — подписи нет");
  assert.doesNotMatch(flat(renderToStaticMarkup(createElement(TraitsSection, { report: report(), accuracy: null }))), /Каких источников/, "отчёт прежней формы — подписи нет, а не «нет ни одного»");
  assert.equal(sourceGapsNote([]), null);
});

test("Источники в долях: считаются по всем моделям раздела (с фото и без, сайты РФ), «мало» — меньше половины моделей или меньше 10 разобранных", () => {
  const h = (sourceId: string, id: string, urls: string[] = ["https://img/x.jpg"]): CatalogHead => ({ sourceId, sourceItemId: id, modelKey: `${sourceId}|${id}`, direction: "bags", title: "", imageUrls: urls, firstSeenAt: "" });
  const heads = [h("S001", "a"), h("S001", "b", []), h("S001", "c", []), h("S001", "a"), h("S128", "r")];
  const shares = sourceShares(heads, [{ sourceId: "S001" }], (id) => (id === "S001" ? "Zara" : ""));
  assert.deepEqual(shares, [
    { sourceId: "S001", name: "Zara", models: 3, eligible: 1, analyzed: 1, ru: false },
    { sourceId: "S128", name: "S128", models: 1, eligible: 0, analyzed: 0, ru: true },
  ], "повтор головы не удваивает модели; без имени — код источника");
  const gaps = sourceGaps([share("A", "A", 100, 100, 60), share("B", "B", 100, 100, 40), share("C", "C", 15, 15, 9), share("D", "D", 15, 15, 15), share("E", "E", 40, 40, 20)]);
  assert.deepEqual(gaps.few.map((s) => s.name), ["B", "C"], "B — меньше половины, C — меньше 10 разобранных; E — ровно половина — не «мало»");
  assert.deepEqual(gaps.absent, []);
});

test("Точность — текущей модели ИИ; прежняя модель отдельно и не смешивается; её низкая точность тоже прячет доли (её разборы ещё в долях)", () => {
  const current = { silhouette: fieldAccuracy(25, 0, 0), proportions: fieldAccuracy(25, 0, 0) };
  const others = [{ aiModel: "polza:old", marks: 40, byField: { proportions: fieldAccuracy(10, 10, 0) } }];
  const t = flat(renderToStaticMarkup(createElement(TraitsSection, { report: report(), accuracy: current, accuracyModel: "polza:google/gemini-2.5-flash", otherAccuracy: others })));
  assert.match(t, /Силуэт .*Точность разбора: верно 25 из 25/);
  assert.match(t, /тоут 66,7%/, "силуэт надёжен у обеих — доли видны");
  assert.match(t, /Пропорции .*Точность разбора: верно 25 из 25 .*Доли не показываем: у прежней модели ИИ «polza:old» \(её разборы этой версии вопроса тоже в долях\) по 20 размеченным моделям верно 50%/);
  assert.doesNotMatch(t, /средняя 50%/, "доли пропорций спрятаны");
  assert.match(t, /по разборам модели ИИ «polza:google\/gemini-2\.5-flash», которая сейчас пишет разбор/);
  assert.match(t, /Отметки разборов прежней моделью ИИ \(«polza:old» — 40\) в эту точность не входят: у каждой модели своя\./);
  assert.equal(fieldHiddenReason("color", current, others), null, "свободный текст не размечается");
  assert.equal(fieldHiddenReason("silhouette", null, others), null, "таблицы отметок нет — доли не прячем");
  assert.match(fieldHiddenReason("silhouette", { silhouette: fieldAccuracy(17, 3, 0) })!, /нижняя граница \d+% ниже порога 80%/, "своя низкая точность — своя причина");
});

test("Сводка разметки: чья точность, отметки прежней модели отдельно, сколько моделей не выдаём из-за недоступного фото", () => {
  const t = flat(renderToStaticMarkup(createElement(AccuracySummary, {
    direction: "bags", accuracy: { silhouette: fieldAccuracy(5, 0, 0) }, accuracyModel: "polza:new", judgedModels: 6, unjudgedModels: 30, otherModelUnjudged: 12, photoUnavailable: 4,
    otherAccuracy: [{ aiModel: "polza:old", marks: 21, byField: {} }],
  })));
  assert.match(t, /Размечено моделей: 6, ещё с неотмеченными признаками: 30\. Точность по признакам у модели ИИ «polza:new», которая сейчас пишет разбор/);
  assert.match(t, /Ещё 4 модели с неотмеченными признаками на разметку не выдаём: фото недоступно \(ссылок на фото у модели больше нет или у вас оно не открылось — такие модели этот браузер запоминает\) — отметить нечем\./);
  assert.match(t, /Ещё 12 моделей разобрано прежней моделью ИИ по тому же вопросу: их выдаём после разборов текущей модели, а отметки по ним идут в точность той модели — отдельно\./);
  assert.match(t, /Отметки по прежней модели ИИ — отдельно и в эту точность не входят: «polza:old» — 21 отметка\./);
  const plain = flat(renderToStaticMarkup(createElement(AccuracySummary, { direction: "bags", accuracy: {}, judgedModels: 0 })));
  assert.doesNotMatch(plain, /не выдаём|прежней модели|разобран/, "нечего сказать — строк нет");
});

test("Блок целиком: до ответа сервера ничего не рисует (не мигает нулями); вёрстка — одна колонка на телефоне, две с md", () => {
  assert.equal(renderToStaticMarkup(createElement(PhotoTraits, { direction: "bags" })), "", "отчёт ещё не пришёл — блока нет");
  const html = renderToStaticMarkup(createElement(TraitsSection, { report: report({ sources: [share("S128", "Lime", 300, 0, 0, true)] }), accuracy: null }));
  assert.match(html, /class="grid gap-3 md:grid-cols-2"/, "карточки признаков — одна колонка до md");
  const ui = readFileSync(join(root, "components/assortment/PhotoTraits.tsx"), "utf8");
  assert.match(ui, /\{gaps && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">\{gaps\}<\/p>\}/, "подпись — абзацем под долями, во всю ширину");
});
