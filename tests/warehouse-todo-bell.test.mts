import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("дела живут в колокольчике шапки, а не полосой под ней", () => {
  const page = read("components/warehouse/WarehousePage.tsx");
  // Полоса печатала «Дел нет» и занимала строку ровно тем, что делать нечего.
  assert.doesNotMatch(page, /TodoBar/, "полоса дел всё ещё рендерится");
  assert.match(page, /<TodoBell/, "колокольчик не подключён");
  // Колокольчик — часть toolbar: он собирается до JSX страницы и уезжает в шапку.
  const start = page.indexOf("const toolbar = (");
  const toolbar = page.slice(start, page.indexOf("  return (", start));
  assert.match(toolbar, /<TodoBell/, "колокольчик не в шапке");
});

test("колокольчик не показывает дела, ведущие на скрытую от роли вкладку", () => {
  const page = read("components/warehouse/WarehousePage.tsx");
  const bell = read("components/warehouse/TodoBell.tsx");
  // Роут дел про роли не знает и считает всё по юрлицу. Без фильтра внешний
  // селлер видел бы дело про маркировку и попадал по нему на экран, которого
  // нет в его меню.
  assert.match(page, /visibleTabs = useMemo\(\(\) => new Set\(tabs\.map/, "набор доступных вкладок не вычисляется");
  assert.match(page, /visibleTabs=\{visibleTabs\}/, "набор вкладок не передан колокольчику");
  assert.match(bell, /filter\(\(item\) => visibleTabs\.has\(item\.tab\)\)/, "дела не отфильтрованы по доступным вкладкам");
});

test("панель дел не вылезает за край экрана и не перекрывает модалки", () => {
  const bell = read("components/warehouse/TodoBell.tsx");
  // Живая проверка на экране 375px: тулбар переносится, колокольчик оказывается
  // не у правого края, и панель шириной 320 уходила левым краем за экран на 163
  // пикселя. Зажим считается в коде — классом такое не выражается.
  assert.match(bell, /Math\.min\(Math\.max\(margin, button\.right - width\), viewport - margin - width\)/, "нет горизонтального зажима панели");
  // window.innerWidth во встроенном браузере приходит нулём — из него получалась
  // панель отрицательной ширины.
  assert.match(bell, /window\.innerWidth \|\| 0/, "нулевая ширина окна не подстрахована");
  // Модалки приёмки и коррекции стоят на z-50: панель дел не должна оказаться
  // поверх открытой формы.
  assert.match(bell, /className="absolute top-full z-40 /, "панель дел не ниже модалок по слою");
  // z-[80] — слой выпадашек в модулях WB и Ozon: там своя закреплённая шапка.
  // Здесь такой слой перекрыл бы открытую форму приёмки.
  assert.doesNotMatch(bell, /className="[^"]*z-\[/, "панель дел поднялась на слой выпадашек WB");
});

test("панель закрывается по Escape, клику вне и переходу по делу", () => {
  const bell = read("components/warehouse/TodoBell.tsx");
  assert.match(bell, /event\.key === "Escape"/, "Escape не закрывает панель");
  assert.match(bell, /addEventListener\("pointerdown", onPointerDown\)/, "клик вне не закрывает панель");
  assert.match(bell, /if \(!open\) return;/, "слушатели висят на document при закрытой панели");
  assert.match(bell, /setOpen\(false\); onGo\(item\.tab\)/, "переход по делу не закрывает панель");
});
