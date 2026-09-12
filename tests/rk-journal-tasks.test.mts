import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { blockMatchesFilter, bothBlockFor } from "../lib/wb/advertBlocks.ts";
import { CTR_MIN_CAMPAIGN_SPEND } from "../lib/wb/ctrCampaignPick.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Замечания по журналу РК с живого обхода 09.09.2026.
 *
 * Все — про одно: экраном работают каждый день по полутора сотням артикулов, и
 * то, что на десятке строк выглядит мелочью, на полутора сотнях становится
 * работой ради работы.
 */

test("кампания «поиск + полки» попадает в полки, когда её об этом просят", () => {
  // Живой случай: кампания «ОТГРУЗКА CPC 1099(150)/бирюзовая» (39880054) стоит
  // у WB на обеих площадках, поэтому по строгому сравнению не попадала ни в
  // «CPC полки», ни в «CPC поиск». Менеджер искал её на полках и не находил.
  assert.equal(blockMatchesFilter("cpc_both", "cpc_shelf", false), false);
  assert.equal(blockMatchesFilter("cpc_both", "cpc_shelf", true), true);
  assert.equal(blockMatchesFilter("cpc_both", "cpc_search", true), true);
  assert.equal(blockMatchesFilter("cpm_both", "cpm_shelf", true), true);
  // Чужой вид переключатель не подмешивает: CPM на полках — это не CPC.
  assert.equal(blockMatchesFilter("cpm_both", "cpc_shelf", true), false);
  assert.equal(blockMatchesFilter("erk", "cpc_shelf", true), false);
  // Точное совпадение работает всегда, без всяких переключателей.
  assert.equal(blockMatchesFilter("cpc_shelf", "cpc_shelf", false), true);
});

test("у «обеих площадок» и у ЕРК парного вида нет", () => {
  // Иначе переключатель предложил бы добавить вид сам к себе.
  assert.equal(bothBlockFor("cpc_both"), null);
  assert.equal(bothBlockFor("cpm_both"), null);
  assert.equal(bothBlockFor("erk"), null);
  assert.equal(bothBlockFor("cpc_shelf"), "cpc_both");
  assert.equal(bothBlockFor("cpm_search"), "cpm_both");
});

test("деньги видов остаются раздельными", () => {
  // Расход кампании «поиск + полки» WB между площадками не делит, поэтому
  // сводка по карточкам считается ДО фильтра. Иначе включение переключателя
  // складывало бы чужие рубли в чужой блок.
  const page = read("../components/wb/WbRkJournalPage.tsx");
  const summary = page.indexOf("const blockSummary = useMemo");
  const filtered = page.indexOf("const visibleItems = useMemo");
  assert.ok(summary > 0 && filtered > 0);
  assert.match(page, /Сводка карточек\n\s+\/\/ считается именно по ним/);
  // Сводка стоит на taggedItems (до фильтра), а не на visibleItems.
  assert.doesNotMatch(page.slice(summary, summary + 1200), /visibleItems/);
});

test("«Обновить» перечитывает и задачи, а не только цифры", () => {
  // Журнал — ночной снимок: цифры за прошедший день не меняются, и нажатие
  // выглядело как отказ кнопки. Менялись как раз задачи, которых кнопка не
  // касалась.
  const page = read("../components/wb/WbRkJournalPage.tsx");
  assert.match(page, /const refreshAll = useCallback\(async \(\) => \{\s*await Promise\.all\(\[load\(\), loadNotes\(\)\]\)/);
  assert.match(page, /onClick=\{\(\) => void refreshAll\(\)\}/);
  // И отметка времени: без неё «данные те же» неотличимо от «кнопка не сработала».
  assert.match(page, /setRefreshedAt/);
});

test("задача в клетке читается целиком, а не через «Изменить текст»", () => {
  // Столбец в 92px с обрезкой показывал «24 ч · ЕРК», а свою формулировку —
  // многоточием. Чтобы узнать назначенное, приходилось открывать клетку.
  const page = read("../components/wb/WbRkJournalPage.tsx");
  assert.match(page, /const TASK_COL = "w-\[150px\] min-w-\[150px\]"/);
  assert.match(page, /line-clamp-2 whitespace-normal break-words/);
  assert.doesNotMatch(page, /\? <span className=\{`truncate /, "задача снова обрезается в одну строку");
});

test("перенос задач заполняет пустое и не трогает чужое решение", () => {
  // То же правило, по которому живёт ночной советчик: уже стоящую задачу не
  // переписывает никто. Иначе перенос затёр бы работу, сделанную с утра.
  const route = read("../app/api/wb/rk-notes/route.ts");
  assert.match(route, /async function copyDay/);
  assert.match(route, /const taken = new Set/);
  assert.match(route, /fresh = rows\.filter\(\(row\) => !taken\.has/);
  // Отметка «сделано» не переносится: вчера сделано, сегодня ещё нет.
  assert.match(route, /done: false/);
  // Перенос — решение человека, а не совет алгоритма.
  assert.match(route, /source: "human"/);
});

test("перенос требует две разные даты и живого кабинета", () => {
  const route = read("../app/api/wb/rk-notes/route.ts");
  assert.match(route, /copyFrom === copyTo/);
  // Права проверяются до записи — как и у одиночной клетки.
  const rights = route.indexOf("rights.canAnnotate");
  const copy = route.indexOf("const result = await copyDay");
  assert.ok(rights > 0 && copy > rights, "перенос обязан стоять после проверки прав");
});

test("«сначала рабочие» меряет рубли, а не показы", () => {
  // Решение владельца: кампания на трёх рублях показов набрать могла, а
  // решать по ней нечего. Порог общий с воронкой — вопрос «работала ли
  // кампания в этот день» один, и ответ на него должен быть один.
  const page = read("../components/wb/WbRkJournalPage.tsx");
  assert.match(page, /import \{ CTR_MIN_CAMPAIGN_SPEND \} from "@\/lib\/wb\/ctrCampaignPick"/);
  assert.match(page, /spentLastDay\(left\) >= CTR_MIN_CAMPAIGN_SPEND/);
  assert.equal(CTR_MIN_CAMPAIGN_SPEND, 100);
  // Нерабочие опускаются, а не прячутся: спрятанная строка выглядит как
  // потерянный товар, и её начинают искать.
  assert.doesNotMatch(page, /workingFirst \? ordered\.filter/);
});

test("предложения алгоритма можно найти, а не искать глазами", () => {
  // Вопрос «где посмотреть, что там заполнил ИИ» задавали прямо: предложения
  // стоят в клетках пунктиром с самого начала, но среди сотен строк их не
  // видно.
  const page = read("../components/wb/WbRkJournalPage.tsx");
  assert.match(page, /const autoCount = useMemo/);
  assert.match(page, /note\.source === "auto"/);
  assert.match(page, /Предложений алгоритма/);
});

test("окно пометки CTR закрывается после сохранения", () => {
  // Пометок за день ставят десятки, и отдельное нажатие «Закрыть» после
  // «Сохранить» было лишним шагом на каждой.
  const popup = read("../components/wb/WbCtrDayPopup.tsx");
  const saved = popup.indexOf("onNoteSaved(nmId, date, body.note");
  const closed = popup.indexOf("onClose();", saved);
  assert.ok(saved > 0 && closed > saved, "после успешного сохранения окно обязано закрываться");
  // Кроме случая, когда есть что сказать: предупреждение о несохранённом
  // цвете иначе мелькнёт и исчезнет вместе с окном.
  assert.match(popup, /colorSkipped\) \{ setError\([\s\S]{0,140}return; \}/);
});

test("шапка журнала сворачивается, чтобы таблице осталось место", () => {
  // Семь карточек по восемь строк занимали 230 пикселей, и вместе с
  // подсказкой, предупреждением и шапкой таблица начиналась на 520-м пикселе:
  // при окне в 1000 пикселей видно четыре строки из двух с половиной сотен.
  // После свёртки таблица начинается с 294-го, строк видно семь.
  const page = read("../components/wb/WbRkJournalPage.tsx");
  assert.match(page, /const \[cardsOpen, setCardsOpen\] = useState\(true\)/);
  // Выбор запоминается: свернул один раз — экран остаётся таким завтра.
  assert.match(page, /localStorage\.setItem\("wb-rk-cards-open"/);
  assert.match(page, /localStorage\.getItem\("wb-rk-cards-open"\)/);
  // Приватное окно бросает на самом доступе к хранилищу — экран от этого
  // падать не должен.
  assert.match(page, /try \{[\s\S]{0,220}wb-rk-cards-open[\s\S]{0,120}\} catch/);
});

test("свёрнутые виды остаются рабочим фильтром, а не картинкой", () => {
  // Иначе свёртка отнимала бы функцию: выбрать вид размещения можно было бы
  // только развернув карточки обратно.
  const page = read("../components/wb/WbRkJournalPage.tsx");
  const collapsed = page.slice(page.indexOf("Свёрнутый вид"), page.indexOf("grid-cols-2 gap-2"));
  assert.match(collapsed, /setBlockFilter\(blockFilter === summary\.block \? "all" : summary\.block\)/);
  assert.match(collapsed, /money\(summary\.spent\)/);
  // Пустой вид не кликается и в свёрнутом виде тоже.
  assert.match(collapsed, /disabled=\{summary\.empty\}/);
});

test("длинное предупреждение не занимает экран постоянно", () => {
  // Три строки объяснения читают один раз, а место они занимали всегда.
  const page = read("../components/wb/WbRkJournalPage.tsx");
  assert.match(page, /<details className="mb-2 rounded-lg border border-amber-200/);
  assert.match(page, /почему это важно/);
  // Сам факт остаётся на виду — прячется только объяснение.
  assert.match(page, /Вне карточек осталось \{count\(outsideCards\.orders\)\}/);
});
