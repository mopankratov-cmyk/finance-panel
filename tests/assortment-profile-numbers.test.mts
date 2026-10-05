import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileCard } from "../components/assortment/BrandProfiles.tsx";
import { BRAND_DEFAULTS } from "../lib/assortment/brandProfiles.ts";
import { buildFormsReport } from "../lib/assortment/forms.ts";
import { formNumbers, undecidedByDemand } from "../lib/assortment/profileNumbers.ts";
import { demandByForm, type SubjectQueries } from "../lib/assortment/wbQueries.ts";

/** Профили брендов: числа рядом с решениями по формам и «прятать, а не дизейблить» (05.10). Спрос — справка, а не вывод. */

const root = fileURLToPath(new URL("..", import.meta.url));
const flat = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const forms = buildFormsReport("jackets", ["S1", "S2", "S3"].flatMap((id) => [
  ...Array.from({ length: 6 }, (_, i) => ({ sourceId: id, sourceName: id, title: `Bomber jacket ${i}` })),
  ...Array.from({ length: 6 }, (_, i) => ({ sourceId: id, sourceName: id, title: `Puffer jacket ${i}` })),
]));
const subject = (rows: Array<[string, number]>): SubjectQueries => ({ subject: "Куртки", windowFrom: "2026-09-06", windowTo: "2026-10-05", current: rows.map(([word, wb_count]) => ({ word, wb_count })), previousTo: null, previous: null });
const demand = demandByForm("jackets", [subject([["куртка женская", 50000], ["пуховик женский", 9000], ["бомбер женский", 1000], ["парка женская", 4000], ["пальто женское", 6000]])])!;

test("Числа форм: доля поисков и доля каталогов — те же, что на «Формах»; без среза спроса — только число моделей", () => {
  const n = formNumbers(forms, demand);
  const puffer = n.get("puffer")!;
  assert.equal(puffer.demandShare, 45, "9 000 из 20 000 названных");
  assert.equal(puffer.supplyShare, 50, "средняя по источникам");
  assert.equal(puffer.models, 18);
  assert.equal(puffer.inDemandTop, true);
  assert.equal(n.get("parka")!.models, 0, "форма есть в поиске, в каталогах нет");
  assert.equal(n.get("jacket"), undefined, "общая «куртка» не форма");
  const noDemand = formNumbers(forms, null);
  assert.equal(noDemand.get("puffer")!.demandShare, null);
  assert.equal(noDemand.get("puffer")!.supplyShare, null);
  assert.equal(noDemand.get("puffer")!.models, 18);
  assert.equal(formNumbers(null, null).size, 0);
});

test("«Не решено» с самым большим спросом: только формы без решения профиля, по убыванию спроса, не больше трёх; решённые не попадают", () => {
  const n = formNumbers(forms, demand);
  const blank = { fitForms: [], avoidForms: [] };
  assert.deepEqual(undecidedByDemand(blank, n).map((x) => x.key), ["puffer", "coat", "parka"]);
  assert.deepEqual(undecidedByDemand({ fitForms: ["puffer"], avoidForms: ["coat"] }, n).map((x) => x.key), ["parka", "bomber"], "решённые (подходит и не подходит) не показываются");
  assert.deepEqual(undecidedByDemand(blank, n, 1).map((x) => x.key), ["puffer"]);
  assert.deepEqual(undecidedByDemand(blank, formNumbers(forms, null)), [], "без среза спроса называть нечего");
});

const norvia = { ...BRAND_DEFAULTS[0] };

test("Карточка профиля: числа у каждой формы, сверху «не решено» с большим спросом и оговорка «спрос — справка»", () => {
  const html = renderToStaticMarkup(createElement(ProfileCard, { profile: norvia, editable: true, numbers: formNumbers(forms, demand) }));
  const t = flat(html);
  assert.match(t, /Пуховик поиски 45% · каталоги 50% среди названных форм · 18 моделей в каталогах/);
  assert.match(t, /Парка поиски 20% · каталоги 0% среди названных форм · 0 моделей в каталогах/, "форма есть в поиске, в каталогах нет");
  assert.match(t, /Не решено по формам с самым большим спросом на WB: Пуховик \(45% поисков\), Пальто \(30% поисков\), Парка \(20% поисков\)\./);
  assert.match(t, /Спрос — справка, а не вывод: «ищут много» не значит «подходит бренду», это решаете вы\./);
  const decided = flat(renderToStaticMarkup(createElement(ProfileCard, { profile: { ...norvia, fitForms: ["puffer", "coat", "parka", "bomber"] }, editable: true, numbers: formNumbers(forms, demand) })));
  assert.doesNotMatch(decided, /Не решено по формам с самым большим спросом/, "всё, что ищут, решено — подсказки сверху нет");
  const partly = flat(renderToStaticMarkup(createElement(ProfileCard, { profile: { ...norvia, fitForms: ["puffer", "coat", "parka"] }, editable: true, numbers: formNumbers(forms, demand) })));
  assert.match(partly, /Не решено по формам с самым большим спросом на WB: Бомбер \(5% поисков\)\./);
  const without = flat(renderToStaticMarkup(createElement(ProfileCard, { profile: norvia, editable: true })));
  assert.doesNotMatch(without, /поиски|каталоги \d/, "чисел ещё нет — строк с числами нет, экран не ломается");
});

test("Не директору — решение текстом, а не отключённые кнопки; директору — кнопки не меньше 40 px; ничего не предзаполнено", () => {
  const profile = { ...norvia, fitForms: ["puffer"], avoidForms: ["fur"], seasons: ["autumn"] };
  const viewer = renderToStaticMarkup(createElement(ProfileCard, { profile, editable: false, numbers: formNumbers(forms, demand) }));
  assert.doesNotMatch(viewer, /disabled/, "ни одной отключённой кнопки");
  assert.doesNotMatch(viewer, /role="radio"/);
  assert.doesNotMatch(viewer, /Подтверждаю профиль/);
  const t = flat(viewer);
  assert.match(t, /Пуховик[^|]*Подходит/);
  assert.match(t, /Мех \/ дублёнка[^|]*Не подходит/);
  assert.match(t, /Сезоны Осень/);
  const empty = flat(renderToStaticMarkup(createElement(ProfileCard, { profile: norvia, editable: false })));
  assert.match(empty, /Сезоны Не решено/);
  assert.doesNotMatch(empty, /Подходит/, "пустой профиль не рисует «подходит»");
  const owner = renderToStaticMarkup(createElement(ProfileCard, { profile, editable: true }));
  assert.match(owner, /role="radio"/);
  assert.match(owner, /h-10 rounded-full/, "кнопки решения не меньше 40 px");
  assert.doesNotMatch(owner, /h-9 /);
});

test("Экран профилей: честная строка, что аудитория, сезоны и палитра пока ни на что не влияют; числа берутся из «Форм» без новых запросов к MPSTATS", () => {
  const view = readFileSync(join(root, "components/assortment/BrandProfiles.tsx"), "utf8");
  assert.match(view, /Аудитория, сезоны и палитра нигде не используются/);
  assert.doesNotMatch(view, /disabled=\{!editable\}/);
  assert.match(view, /\/api\/assortment-development\/forms\?direction=/);
});
