import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// Regression test for QA ISSUE-006: 390px viewport on /cabinets and /sync.
test("system layout and cabinet forms may shrink to the mobile viewport", () => {
  // Главное здесь — `min-w-0` на основной области: без него флекс-элемент не
  // сжимается уже своего содержимого, и любая широкая таблица распирает всю
  // страницу. Отступ под боковую панель раньше дублировался классом
  // `lg:ml-64`, но панель с планшета стоит в потоке, и её ширину вычитает сам
  // флексбокс — проверять надо свойство, а не конкретную величину отступа,
  // иначе тест ломается при каждой смене ширины панели.
  const layout = source("components/AppLayout.tsx");
  assert.match(layout, /<main className="min-w-0 flex-1/);
  assert.doesNotMatch(layout, /<main[^>]*\bml-\d/, "ширина боковой панели снова продублирована отступом");
  const cabinets = source("app/cabinets/page.tsx");
  assert.match(cabinets, /grid grid-cols-1 gap-2 sm:grid-cols-2/);
  assert.match(cabinets, /w-full min-w-0 rounded-lg/);
});

test("sync journal scrolls inside its card instead of widening the page", () => {
  const sync = source("components/sync/SyncPage.tsx");
  // Смысл: у КАЖДОЙ широкой таблицы журнала есть свой прокручиваемый контейнер
  // прямо над ней. Искать `scroll-x` и `min-w-[720px]` порознь по файлу
  // нельзя — проверка прошла бы и в случае, когда контейнер остался у одной
  // таблицы, а минимальная ширина у другой. Поэтому ищем именно пары
  // «контейнер с прокруткой, а следом таблица со своей минимальной шириной».
  const pairs = sync.match(/(scroll-x|overflow-x-auto)[^]{0,220}?min-w-\[720px\]/g) ?? [];
  const tables = sync.match(/min-w-\[720px\]/g) ?? [];
  assert.ok(tables.length > 0, "широкие таблицы журнала исчезли");
  assert.equal(pairs.length, tables.length, "у широкой таблицы журнала нет своего контейнера с прокруткой");
  assert.match(sync, /max-w-full/);
});
