import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormFilterMissing, FormFilterNote } from "../components/assortment/CatalogView.tsx";
import { FormsReportView, ModelsLink } from "../components/assortment/FormsView.tsx";
import { catalogFiltersFrom, filtersForForm, FORM_UNRECOGNIZED, formFilterLabel, parseCatalogQuery, parseFormKey, toCatalogCard, type CatalogRow } from "../lib/assortment/catalog.ts";
import { loadCatalog, resetHeadsFlag } from "../lib/assortment/catalogStore.ts";
import { buildFormsReport, formOf } from "../lib/assortment/forms.ts";
import { loadFormModels, loadFormsReport } from "../lib/assortment/formsStore.ts";

/** Фильтр «Форма» в каталоге: от строки формы к моделям и фото (05.10). Форма — по названию, как на «Формах». */

const root = fileURLToPath(new URL("..", import.meta.url));
const NOW = Date.parse("2026-10-05T12:00:00Z");

test("Адрес: форма — только известное правило раздела или «unrecognized»; чужое и мусор отбрасываются", () => {
  assert.equal(parseFormKey("bomber", "jackets"), "bomber");
  assert.equal(parseFormKey("bomber", "bags"), null, "у сумок такой формы нет");
  assert.equal(parseFormKey("tote", "bags"), "tote");
  assert.equal(parseFormKey(FORM_UNRECOGNIZED, "bags"), FORM_UNRECOGNIZED);
  assert.equal(parseFormKey("'; drop table", "jackets"), null);
  assert.equal(parseFormKey(null, "jackets"), null);
  const params = (q: string) => new URLSearchParams(q);
  assert.equal(parseCatalogQuery(params("form=puffer&photo=all"), "jackets").form, "puffer");
  assert.equal(parseCatalogQuery(params("form=nonsense"), "jackets").form, null);
  assert.equal(catalogFiltersFrom({ form: "puffer" }).form, "puffer");
  assert.equal(catalogFiltersFrom({ form: "DROP TABLE" }).form, null);
  assert.equal(catalogFiltersFrom({}).form, null);
  assert.equal(formFilterLabel("bomber", "jackets"), "Бомбер");
  assert.equal(formFilterLabel(FORM_UNRECOGNIZED, "jackets"), "Название не называет форму");
});

const row = (title: string, over: Partial<CatalogRow> = {}): CatalogRow => ({
  source_id: "S001", source_item_id: title, handle: null, title, product_type: null, first_seen_at: "2026-10-01T00:00:00Z", last_seen_at: "2026-10-05T00:00:00Z", baseline: true, reference_id: null, image_urls: ["https://img.example/a.jpg"], brand: null, badges: null, variants: 1, ...over,
});

test("Карточка: форма по названию — та же, что считают «Формы»; название формы не называет — null; без раздела — null", () => {
  assert.deepEqual(toCatalogCard(row("Bomber jacket"), undefined, NOW, "jackets").form, { key: "bomber", label: "Бомбер" });
  assert.deepEqual(toCatalogCard(row("Куртка женская"), undefined, NOW, "jackets").form, { key: "jacket", label: "Куртка (форма не названа)" });
  assert.equal(toCatalogCard(row("Numero Un"), undefined, NOW, "bags").form, null);
  assert.equal(toCatalogCard(row("Bomber jacket"), undefined, NOW).form, null, "раздел не передан — формы нет");
});

/** Подставная база: вид голов (лёгкая и полная выборка), источники, статусы находок. Фильтры читает так же, как PostgREST. */
function fakeDb(heads: Array<Record<string, unknown>>, opts: { noView?: boolean; items?: Array<Record<string, unknown>>; stats?: Array<Record<string, unknown>> } = {}) {
  const calls: Array<{ table: string; select: string; filters: string[] }> = [];
  const db = {
    from: (table: string) => {
      const call = { table, select: "", filters: [] as string[] };
      calls.push(call);
      const eqs: Array<[string, unknown]> = [];
      const preds: Array<(r: Record<string, unknown>) => boolean> = [];
      const sorts: Array<[string, boolean]> = [];
      let ins: [string, unknown[]] | null = null;
      const rows = () => {
        if (table === "assortment_sources") return [{ source_id: "S001", name: "Zara", seed_urls: ["https://zara.example"] }, { source_id: "S002", name: "ASOS", seed_urls: [] }];
        if (table === "assortment_source_items" && opts.items) return opts.items.filter((h) => eqs.every(([c, v]) => h[c] === v) && preds.every((p) => p(h)));
        if (table === "assortment_catalog_stats") return opts.stats ?? [];
        if (table !== "assortment_catalog_heads" || opts.noView) return [];
        // Фильтры применяются по-настоящему: скрытые, давно не виденные и без фото модели должны выпадать из обоих путей одинаково.
        const list = heads.filter((h) => eqs.every(([c, v]) => h[c] === v) && preds.every((p) => p(h)) && (!ins || ins[1].includes(h[ins[0]])));
        return list.sort((a, b) => {
          for (const [col, asc] of sorts) {
            const x = String(a[col] ?? "");
            const y = String(b[col] ?? "");
            if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        });
      };
      // Вида голов нет (миграция 202610050002 не применена) — база отвечает так же, как PostgREST.
      const failure = () => (table === "assortment_catalog_heads" && opts.noView ? { code: "PGRST205", message: "Could not find the table 'public.assortment_catalog_heads' in the schema cache" } : null);
      const q: Record<string, unknown> = {
        select: (columns: string) => { call.select = columns; return q; },
        eq: (c: string, v: unknown) => { call.filters.push(`eq:${c}=${v}`); eqs.push([c, v]); return q; },
        gte: (c: string, v: unknown) => { call.filters.push(`gte:${c}`); preds.push((r) => String(r[c] ?? "") >= String(v)); return q; },
        is: (c: string, v: unknown) => { call.filters.push(`is:${c}`); preds.push((r) => (r[c] ?? null) === v); return q; },
        not: (c: string, _op: string, v: unknown) => { call.filters.push(`not:${c}`); preds.push((r) => (r[c] ?? null) !== v); return q; },
        or: () => q,
        in: (c: string, v: unknown[]) => { call.filters.push(`in:${c}`); ins = [c, v]; return q; },
        order: (c: string, o?: { ascending?: boolean }) => { sorts.push([c, o?.ascending !== false]); return q; },
        range: (from: number, to: number) => Promise.resolve(failure() ? { data: null, error: failure(), count: null } : { data: rows().slice(from, to + 1), error: null, count: rows().length }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(failure() ? { data: null, error: failure(), count: null } : { data: rows(), error: null, count: rows().length }).then(resolve),
      };
      return q;
    },
  };
  return { db: db as never, calls };
}

let tick = 0;
const head = (source: string, title: string, over: Record<string, unknown> = {}) => ({
  source_id: source, source_item_id: `${source}-${title}`, direction: "jackets", handle: null, title, product_type: null,
  // Свежее — позже в списке заданных; порядок страницы должен идти по дате, а не по источнику.
  model_first_seen_at: `2026-10-01T00:00:${String(10 + (tick += 1) % 50).padStart(2, "0")}Z`,
  first_seen_at: "2026-10-01T00:00:00Z", last_seen_at: "2026-10-05T00:00:00Z", baseline: true, reference_id: null,
  model_last_seen_at: "2026-10-05T00:00:00Z", model_hidden_at: null,
  image_urls: ["https://img.example/a.jpg"], brand: null, badges: null, variants: 1, ...over,
});
const heads = [
  ...Array.from({ length: 5 }, (_, i) => head("S001", `Bomber jacket ${i}`)),
  ...Array.from({ length: 3 }, (_, i) => head("S002", `Bomber in black ${i}`, { model_first_seen_at: `2026-10-01T00:00:${String(40 + i)}Z` })),
  ...Array.from({ length: 4 }, (_, i) => head("S001", `Puffer jacket ${i}`)),
  head("S002", "Numero Un"),
  head("S002", "Куртка женская"),
  // Не должны попасть ни в «Формы», ни в каталог: скрыта кнопкой «Не интересно», давно не видна на сайте.
  head("S001", "Bomber hidden", { model_hidden_at: "2026-10-04T00:00:00Z" }),
  head("S001", "Bomber gone", { model_last_seen_at: "2026-08-01T00:00:00Z" }),
  head("S002", "Puffer hidden", { model_hidden_at: "2026-10-03T00:00:00Z" }),
];
/** Модели, которые видит и каталог, и «Формы»: не скрыты и видны на сайте в последние 30 дней. */
const visible = heads.filter((h) => !h.model_hidden_at && String(h.model_last_seen_at) >= "2026-09-05");
const base = { direction: "jackets" as const, sourceId: null, search: null, fresh: false, badge: false, photo: "all" as const, offset: 0, limit: 48 };

test("Каталог по форме: в выдаче только модели этой формы, итог — все такие модели, а не только страница; порядок и страница как у каталога", async () => {
  resetHeadsFlag();
  const { db, calls } = fakeDb(heads);
  const first = await loadCatalog(db, { ...base, form: "bomber", limit: 5 }, NOW);
  assert.equal(first.total, 8, "5 + 3 бомберов из двух источников");
  assert.equal(first.cards.length, 5);
  assert.ok(first.cards.every((c) => c.form?.key === "bomber"));
  const second = await loadCatalog(db, { ...base, form: "bomber", offset: 5, limit: 5 }, NOW);
  assert.equal(second.cards.length, 3, "вторая страница — остаток");
  const ids = [...first.cards, ...second.cards].map((c) => c.itemId);
  assert.equal(new Set(ids).size, 8, "страницы не пересекаются");
  const dates = visible.filter((h) => String(h.title).toLowerCase().includes("bomber")).sort((a, b) => String(b.model_first_seen_at).localeCompare(String(a.model_first_seen_at))).map((h) => h.source_item_id);
  assert.deepEqual(ids, dates, "порядок страниц — свежие первыми, источники перемешаны, а не сгруппированы");
  assert.ok(new Set(first.cards.map((c) => c.sourceId)).size > 1 || new Set(second.cards.map((c) => c.sourceId)).size > 1, "в выдаче оба источника");
  assert.ok(calls.some((c) => c.table === "assortment_catalog_heads" && c.select === "source_id,source_item_id,title"), "список форм — лёгкой выборкой");
  assert.ok(calls.some((c) => c.filters.includes("in:source_item_id")), "полные строки — только страницы");
});

test("Каталог по форме: число совпадает со строкой на «Формах» — для каждой формы; «unrecognized» — моделям без формы", async () => {
  resetHeadsFlag();
  const { db } = fakeDb(heads);
  const report = buildFormsReport("jackets", await loadFormModels(db, "jackets", NOW));
  assert.ok(report.rows.length >= 3);
  for (const formRow of report.rows) {
    const page = await loadCatalog(db, { ...base, form: formRow.key }, NOW);
    assert.equal(page.total, formRow.models, `форма «${formRow.label}»: в каталоге ${page.total}, на «Формах» ${formRow.models}`);
    assert.equal(page.cards.length, formRow.models);
  }
  const none = await loadCatalog(db, { ...base, form: FORM_UNRECOGNIZED }, NOW);
  assert.equal(none.total, report.unrecognized.count);
  assert.deepEqual(none.cards.map((c) => c.title), ["Numero Un"]);
  assert.ok(none.cards.every((c) => formOf("jackets", c.title) === null));
});

test("Каталог по форме: остальные фильтры работают вместе (бренд), без формы — прежнее поведение; страница без совпадений пустая", async () => {
  resetHeadsFlag();
  const { db, calls } = fakeDb(heads);
  const byBrand = await loadCatalog(db, { ...base, form: "bomber", sourceId: "S002" }, NOW);
  assert.equal(byBrand.total, 3);
  assert.ok(calls.some((c) => c.filters.includes("eq:source_id=S002")));
  const none = await loadCatalog(db, { ...base, form: "fur" }, NOW);
  assert.equal(none.total, 0);
  assert.deepEqual(none.cards, []);
  const plain = await loadCatalog(db, { ...base }, NOW);
  assert.equal(plain.total, visible.length, "без формы — весь видимый каталог раздела (скрытые и пропавшие не в счёт)");
});

test("Каталог по форме без вида голов (миграция не применена): понятная ошибка, а не пустая выдача", async () => {
  resetHeadsFlag();
  const failing = {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "is", "not", "or", "in", "order"]) q[m] = () => q;
      q.range = () => Promise.resolve({ data: null, error: table === "assortment_catalog_heads" ? { code: "PGRST205", message: "Could not find the table 'public.assortment_catalog_heads' in the schema cache" } : null, count: null });
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === "assortment_sources" ? [] : null, error: table === "assortment_catalog_heads" ? { code: "PGRST205", message: "Could not find the table 'public.assortment_catalog_heads' in the schema cache" } : null }).then(resolve);
      return q;
    },
  } as never;
  await assert.rejects(() => loadCatalog(failing, { ...base, form: "bomber" }, NOW), /миграции 202610050002/);
  resetHeadsFlag();
});

test("Плашка фильтра: подпись формы, число моделей, «по названию, а не по фото», кнопка «Сбросить форму»", () => {
  const html = renderToStaticMarkup(createElement(FormFilterNote, { form: "bomber", direction: "jackets", total: 8, onReset: () => undefined }));
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /Форма по названию: Бомбер — 8 моделей\./);
  assert.match(text, /не по фото/);
  assert.match(text, /Сбросить форму/);
  assert.match(html, /h-10/, "кнопка не меньше 40 px");
  const loading = renderToStaticMarkup(createElement(FormFilterNote, { form: FORM_UNRECOGNIZED, direction: "bags", total: null, onReset: () => undefined }));
  assert.match(loading, /Название не называет форму/);
});

test("Экран: форма попадает в адрес и в запрос каталога, при выходе из каталога фильтр сбрасывается", () => {
  const view = readFileSync(join(root, "components/assortment/CatalogView.tsx"), "utf8");
  assert.match(view, /\n  set\("form", filters\.form\);/, "форма пишется в адрес страницы");
  assert.match(view, /if \(filters\.form\) params\.set\("form", filters\.form\)/, "и уходит в запрос каталога");
  const section = readFileSync(join(root, "components/assortment/AssortmentSection.tsx"), "utf8");
  assert.match(section, /\["source", "q", "fresh", "badge", "form", "photo"\]/);
});

test("«Формы»: в раскрытой строке и у «Название не называет форму» — «Показать модели» со ссылкой в каталог (форма и «и без фото» в адресе)", () => {
  const report = buildFormsReport("jackets", [
    ...Array.from({ length: 12 }, (_, i) => ({ sourceId: "S1", sourceName: "Zara", title: `Bomber jacket ${i}` })),
    { sourceId: "S1", sourceName: "Zara", title: "Numero Un" }, { sourceId: "S1", sourceName: "Zara", title: "Numero Deux" },
  ]);
  const closed = renderToStaticMarkup(createElement(FormsReportView, { report }));
  assert.doesNotMatch(closed, /Показать модели/, "в свёрнутой строке ссылки нет");
  const html = renderToStaticMarkup(createElement(FormsReportView, { report, openForms: ["bomber"], unrecognizedOpen: true }));
  assert.match(html, /href="\/assortment-development\/jackets\?view=catalog&amp;form=bomber&amp;photo=all"/);
  assert.match(html, /href="\/assortment-development\/jackets\?view=catalog&amp;form=unrecognized&amp;photo=all"/);
  const t = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(t, /Показать модели · 12/, "число на кнопке — как в строке формы");
  assert.match(t, /Показать модели · 2/);
  assert.match(html, /h-10/, "кнопка не меньше 40 px");
  const bags = renderToStaticMarkup(createElement(FormsReportView, { report: buildFormsReport("bags", Array.from({ length: 3 }, (_, i) => ({ sourceId: "S1", sourceName: "A", title: `Tote bag ${i}` }))), openForms: ["tote"] }));
  assert.match(bags, /href="\/assortment-development\/bags\?view=catalog&amp;form=tote&amp;photo=all"/, "у сумок — свой раздел");
});

// --- по ревью #1497 ---

test("Адрес: чужой раздел и устаревший ключ формы отбрасываются на серверной странице — экран не скажет «фильтр включён», когда список целый", () => {
  assert.equal(catalogFiltersFrom({ form: "bomber" }, "bags").form, null, "«bomber» на сумках");
  assert.equal(catalogFiltersFrom({ form: "bomber" }, "jackets").form, "bomber");
  assert.equal(catalogFiltersFrom({ form: "retired_rule" }, "jackets").form, null, "ключ, которого больше нет в правилах");
  assert.equal(catalogFiltersFrom({ form: FORM_UNRECOGNIZED }, "bags").form, FORM_UNRECOGNIZED);
  assert.deepEqual(filtersForForm("tote"), { source: null, q: "", fresh: false, badge: false, form: "tote", photo: "all" });
  const pages = ["jackets", "bags"].map((d) => readFileSync(join(root, `app/assortment-development/${d}/page.tsx`), "utf8"));
  assert.match(pages[0], /catalogFiltersFrom\(params, "jackets"\)/);
  assert.match(pages[1], /catalogFiltersFrom\(params, "bags"\)/);
});

test("Сервер называет применённую форму; при ключе, которого раздел не знает, фильтр не применяется и это видно (плашка «такой формы нет»)", async () => {
  resetHeadsFlag();
  const { db } = fakeDb(heads);
  assert.equal((await loadCatalog(db, { ...base, form: "puffer" }, NOW)).form, "puffer");
  assert.equal((await loadCatalog(db, { ...base }, NOW)).form, null, "без фильтра формы нет");
  const html = renderToStaticMarkup(createElement(FormFilterMissing, { onReset: () => undefined }));
  assert.match(html.replace(/<[^>]+>/g, " "), /Такой формы в этом разделе нет .* показан весь каталог/);
  assert.match(html, /h-10/);
  const view = readFileSync(join(root, "components/assortment/CatalogView.tsx"), "utf8");
  assert.match(view, /ready\.form !== filters\.form[\s\S]*FormFilterMissing/, "плашка «фильтр включён» — только когда сервер форму применил");
});

test("С фильтром формы режим фото «auto» не решается по общей доле фото: число совпадает со строкой формы, где считаются все модели", async () => {
  resetHeadsFlag();
  const withoutPhoto = head("S001", "Bomber no photo", { image_urls: null });
  const { db } = fakeDb([...heads, withoutPhoto], { stats: [{ source_id: "S001", direction: "jackets", models: 100, with_photo: 90, new_7d: 0 }] });
  const plain = await loadCatalog(db, { ...base, photo: "auto" }, NOW);
  assert.equal(plain.photo, "with", "без формы «auto» по-прежнему решают счётчики (фото у 90%)");
  const byForm = await loadCatalog(db, { ...base, photo: "auto", form: "bomber" }, NOW);
  assert.equal(byForm.photo, "all");
  assert.equal(byForm.total, visible.filter((h) => String(h.title).toLowerCase().includes("bomber")).length + 1, "и модель без фото в счёте, как на «Формах»");
});

test("Набор моделей «Форм» и каталога — один код (baseHeadsFilters); без вида голов «Формы» знают об этом и прячут ссылки", async () => {
  const forms = readFileSync(join(root, "lib/assortment/formsStore.ts"), "utf8");
  const store = readFileSync(join(root, "lib/assortment/catalogStore.ts"), "utf8");
  assert.match(forms, /baseHeadsFilters\(db\.from\("assortment_catalog_heads"\)/);
  assert.match(store, /baseHeadsFilters\(builder, query\.direction, nowMs\)/);
  const { db } = fakeDb(heads);
  const report = await loadFormsReport(db, "jackets", NOW);
  assert.equal(report.viaHeads, true);
  assert.equal(report.models, visible.length, "скрытые и пропавшие в «Формы» не попадают");
  const fallback = fakeDb(heads, { noView: true, items: [
    { source_id: "S001", source_item_id: "1", direction: "jackets", title: "Bomber jacket", last_seen_at: "2026-10-05T00:00:00Z" },
    { source_id: "S002", source_item_id: "2", direction: "jackets", title: "Puffer jacket", last_seen_at: "2026-10-05T00:00:00Z" },
  ] });
  const noView = await loadFormsReport(fallback.db, "jackets", NOW);
  assert.equal(noView.viaHeads, false);
  assert.equal(noView.models, 2, "строки таблицы, как раньше");
  const html = renderToStaticMarkup(createElement(FormsReportView, { report: noView, openForms: ["bomber"], unrecognizedOpen: true }));
  assert.doesNotMatch(html, /Показать модели/, "фильтр без вида голов не работает — ссылку прячем, а не ведём в тупик");
  const withView = renderToStaticMarkup(createElement(FormsReportView, { report: { ...report, viaHeads: true }, openForms: ["bomber"] }));
  assert.match(withView, /Показать модели/);
});

test("«Показать модели»: внутри раздела — кнопка с обратным вызовом (повторный переход к той же форме работает), отдельно — ссылка с адресом", () => {
  const calls: string[] = [];
  const button = renderToStaticMarkup(createElement(ModelsLink, { direction: "jackets", form: "bomber", count: 8, onShow: (f: string) => calls.push(f) }));
  assert.match(button, /^<button type="button"/);
  assert.doesNotMatch(button, /href=/);
  const link = renderToStaticMarkup(createElement(ModelsLink, { direction: "jackets", form: "bomber", count: 8 }));
  assert.match(link, /^<a /);
  assert.match(link, /view=catalog&amp;form=bomber&amp;photo=all/);
  const section = readFileSync(join(root, "components/assortment/AssortmentSection.tsx"), "utf8");
  assert.match(section, /const showModels = \(form: string\) => \{[\s\S]*setCatalogFilters\(filtersForForm\(form\)\);[\s\S]*setCatalogKey\(\(k\) => k \+ 1\);[\s\S]*setView\("catalog"\);/);
  assert.match(section, /<CatalogView key=\{catalogKey\} direction=\{direction\} initialFilters=\{catalogFilters\} onFiltersChange=\{setCatalogFilters\}/);
  assert.match(section, /<FormsView direction=\{direction\} onShowModels=\{showModels\}/);
  const view = readFileSync(join(root, "components/assortment/CatalogView.tsx"), "utf8");
  assert.match(view, /onFiltersChange\?\.\(filters\)/, "каталог сообщает разделу текущие фильтры — возврат на вкладку не воскрешает сброшенную форму");
});

test("Плашка: число — «с учётом выбранных фильтров», когда включены бренд/поиск/новое/метка/«только с фото»; чипы брендов в режиме формы без общих счётчиков", () => {
  const plain = renderToStaticMarkup(createElement(FormFilterNote, { form: "bomber", direction: "jackets", total: 8, onReset: () => undefined }));
  assert.doesNotMatch(plain, /с учётом выбранных фильтров/);
  const narrowed = renderToStaticMarkup(createElement(FormFilterNote, { form: "bomber", direction: "jackets", total: 3, narrowed: true, onReset: () => undefined }));
  assert.match(narrowed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), /Бомбер — 3 модели с учётом выбранных фильтров/);
  const view = readFileSync(join(root, "components/assortment/CatalogView.tsx"), "utf8");
  assert.match(view, /\{!byForm && ` · \$\{shown\(b\)\.toLocaleString\("ru-RU"\)\}`\}/);
  assert.match(view, /const hiddenWithoutPhoto = !byForm && photoOnly/);
});

test("Роут каталога: время до минуты — фильтр по форме читает все модели раздела, как «Формы»", () => {
  const route = readFileSync(join(root, "app/api/assortment-development/catalog/route.ts"), "utf8");
  assert.match(route, /export const maxDuration = 60/);
});
