import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Правило владельца 05.09.2026: экран должен открываться практически мгновенно.
 * Условный рендер вкладок (`tab === "x" ? <A/> : <B/>`) размонтирует компонент
 * при каждом переключении — данные грузятся заново, состояние теряется.
 * На складе это стоило 3–7 секунд НА КАЖДЫЙ заход.
 */
test("общий примитив держит посещённые вкладки и сбрасывается по ключу", () => {
  const source = read("../components/ui/KeepAliveTabs.tsx");
  // Непосещённая вкладка не рендерится вовсе — иначе первый вход поднял бы
  // все вкладки разом и заплатил за них запросами.
  assert.match(source, /if \(!visited\) return null;/);
  assert.match(source, /className=\{active \? "" : "hidden"\}/);
  assert.match(source, /aria-hidden=\{!active\}/, "скринридер не должен читать три экрана подряд");
  assert.match(source, /setVisited\(new Set<T>\(\[active\]\)\);/, "сброс по resetKey");
  assert.match(source, /useState<Set<T>>\(\(\) => new Set<T>\(\[active\]\)\)/, "стартовая вкладка сразу посещена");
});

/**
 * Экраны, где дочерние вкладки грузят себя на монтировании либо держат
 * незаконченную работу: уход и возврат стоили запроса и потерянного места.
 */
test("экраны с самозагружающимися вкладками переведены на примитив", () => {
  const screens = {
    "../components/warehouse/WarehousePage.tsx": ["balances", "receipts", "moves"],
    "../components/wb/WbAdvertsPage.tsx": ["phrases", "rules", "log"],
    "../components/wb/ads/WbAdControlPage.tsx": ["clusters", "create", "rules", "journal"],
    "../components/supplies/SuppliesPage.tsx": ["stock", "receiving", "source"],
  };
  for (const [file, tabs] of Object.entries(screens)) {
    const source = read(file);
    assert.match(source, /useKeepAliveTabs</, file);
    assert.match(source, /from "@\/components\/ui\/KeepAliveTabs"/, `${file}: импорт`);
    for (const tab of tabs) assert.ok(source.includes(`("${tab}")`), `${file}: ${tab}`);
  }
});

/** Ключ сброса — то, при смене чего показанное перестаёт быть правдой. Без
 *  него на соседней вкладке остались бы данные чужого кабинета или юрлица. */
test("у каждого экрана задан ключ сброса", () => {
  assert.match(read("../components/warehouse/WarehousePage.tsx"), /useKeepAliveTabs<Tab>\(tab, entityId\)/);
  assert.match(read("../components/wb/WbAdvertsPage.tsx"), /useKeepAliveTabs<ModuleView>\(view, cabinetId \|\| "all"\)/);
  assert.match(read("../components/wb/ads/WbAdControlPage.tsx"), /useKeepAliveTabs<TabId>\(tab, cabinetId\)/);
  assert.match(read("../components/supplies/SuppliesPage.tsx"), /useKeepAliveTabs<Tab>\(tab, cabId\)/);
});

/**
 * Раз вкладки теперь остаются смонтированными, заглушка поверх уже показанных
 * данных стала вреднее вдвойне: «Обновить» на одной вкладке гасило бы вид на
 * всех. Показываем прежнее, пока едет новое.
 */
test("заглушка не подменяет уже показанные данные", () => {
  const guards = {
    "../components/warehouse/ReceiptsTab.tsx": "if (loading && rows.length === 0) return",
    "../components/warehouse/MovesTab.tsx": "if (loading && rows.length === 0) return",
    "../components/warehouse/MovementTab.tsx": "if (loading && !balances) return",
    "../components/warehouse/KizTab.tsx": "if (loading && !summary) return",
    "../components/warehouse/DocsTab.tsx": "if (loading && !data) return",
    "../components/warehouse/BalancesTab.tsx": "if (loading && !data) return",
  };
  for (const [file, guard] of Object.entries(guards)) {
    const source = read(file);
    assert.ok(source.includes(guard), `${file}: ожидал «${guard}»`);
    assert.doesNotMatch(source, /if \(loading\) return </, `${file}: осталась безусловная заглушка`);
  }
});

/**
 * listAccessibleEntities зовут ВСЕ роуты склада до собственной работы, а
 * некоторые дважды за один запрос (kiz: resolveEntity + прямой вызов). Каждый
 * повтор — два круга к базе по 0,35 с на ровном месте.
 */
test("справочник юрлиц считается один раз на запрос", () => {
  const source = read("../lib/warehouse/entityAccess.ts");
  assert.match(source, /^import \{ cache \} from "react";/m);
  assert.match(source, /export const listAccessibleEntities = cache\(async function listAccessibleEntities/);
  // Тот же приём и по той же причине уже применён к сессии.
  assert.match(read("../lib/auth/server.ts"), /export const getServerSession = cache\(/);
});

/**
 * Ответы возвращаются вразнобой: более ранний запрос может прийти последним и
 * лечь поверх свежего — на экране данные не того периода, что подписан сверху.
 * Счётчик запросов отсекает всё, что пришло не к последнему.
 */
test("экраны не кладут старый ответ поверх нового", () => {
  const guarded = [
    "../components/wb/WbRkJournalPage.tsx",
    "../components/wb/WbCompetitorsView.tsx",
    "../components/warehouse/ProductsTab.tsx",
  ];
  for (const file of guarded) {
    const source = read(file);
    assert.match(source, /const requestId = useRef\(0\);/, `${file}: нет счётчика`);
    assert.match(source, /const current = \+\+requestId\.current;/, file);
    assert.match(source, /if \(current !== requestId\.current\) return;/, `${file}: ответ не отсекается`);
    assert.match(source, /if \(current === requestId\.current\) setLoading\(false\)/, `${file}: индикатор гасит чужой ответ`);
  }
});

/** Второй заход по вкладкам: экраны, где дочерние компоненты сами ходят в сеть
 *  или держат незаконченную работу. */
test("вкладки поставок, полок и платежей тоже держатся", () => {
  const screens = {
    "../components/wb/WbSuppliesPage.tsx": ["stock", "receiving", "source"],
    "../components/wb/WbShelfPage.tsx": ["competitors"],
    "../components/payments/PaymentsPage.tsx": ["dds", "review", "reconciliation"],
  };
  for (const [file, tabs] of Object.entries(screens)) {
    const source = read(file);
    assert.match(source, /useKeepAliveTabs</, file);
    for (const tab of tabs) assert.ok(source.includes(`panel("${tab}")`), `${file}: ${tab}`);
  }
  // Закупки: заглушка не сносит панель «Мой склад» с незаконченным вводом.
  assert.match(read("../components/supplies/SuppliesPage.tsx"), /loading && skus\.length === 0/);
});

/**
 * Секундомер стоял ПОСЛЕ гейта: чтение пользователя из базы — самый частый
 * круг во всём продукте — не попадало в замер вовсе, а mark("gate") всегда
 * показывал ноль.
 */
test("замер включает авторизацию, а не начинается после неё", () => {
  const source = read("../app/api/warehouse/stock/route.ts");
  const timer = source.indexOf("const startedAt = Date.now();");
  const gate = source.indexOf("const gate = await requireApiSession();");
  assert.ok(timer > 0 && gate > 0);
  assert.ok(timer < gate, "секундомер обязан стартовать до проверки сессии");
});

/**
 * Колонки карточки кампании наезжали друг на друга: элементы верхней строки
 * все `shrink-0`, а правая колонка была уже своего содержимого — при
 * выравнивании по правому краю лишнее уходило ВЛЕВО, поверх названия товара.
 */
test("строка кампании не даёт колонкам наезжать", () => {
  const source = read("../components/wb/WbAdvertsPage.tsx");
  assert.match(source, /<div className="flex flex-wrap items-center gap-x-1\.5 gap-y-1">/, "бейджи переносятся");
  assert.match(source, /w-\[148px\] shrink-0 overflow-hidden text-right/, "правая колонка не выливается за край");
});

/**
 * Действия по кампании лежали ПОСЛЕ посуточной таблицы: чтобы нажать «Пауза»,
 * человек пролистывал два экрана метрик и тридцать строк статистики.
 */
test("действия по кампании стоят под шапкой, а не в конце", () => {
  const source = read("../components/wb/WbAdvertsPage.tsx");
  const header = source.indexOf("Тесты CTR по этому артикулу");
  const actions = source.indexOf("{singleCabinet && cabinetMoney ? (", header);
  const table = source.indexOf('<table className="w-full min-w-[640px]', header);
  assert.ok(header > 0 && actions > 0 && table > 0);
  assert.ok(actions < table, "действия обязаны стоять выше посуточной таблицы");
});

/**
 * В галерее CTR-теста целый ряд плиток был пустыми серыми прямоугольниками с
 * замком: у этих записей каталога вместо адреса записан путь на Яндекс.Диске —
 * ни показать, ни отдать в тест. Место занимали, не сообщая ничего.
 */
test("галерея контента не показывает то, что нечем нарисовать", () => {
  const source = read("../components/wb/ctr/ContentPicker.tsx");
  assert.match(source, /items\.filter\(\(item\) => item\.usability !== "unresolved" && item\.usability !== "missing"\)/);
  assert.match(source, /Ещё \{hidden\}/, "скрытое считаем вслух, а не молча");
  assert.match(source, /\{shown\.map\(\(item\) => \{/);
});

test("своё фото можно загрузить и убрать", () => {
  const source = read("../components/wb/ctr/ContentPicker.tsx");
  assert.match(source, /\/api\/content\/upload/);
  assert.match(source, /isPanelUpload\(item\.url\)/, "корзина только на своих загрузках");
  assert.match(source, /window\.confirm/, "удаление файла необратимо — спрашиваем");

  const route = read("../app/api/content/upload/route.ts");
  assert.match(route, /hasCabinetAccess\(cabinetId\)/, "чужой кабинет");
  assert.match(route, /if \(!isPanelUpload\(target\)\)/, "чужие файлы удалять нельзя");
  assert.match(route, /target\.includes\(`\/\$\{PREFIX\}\/\$\{cabinetId\}\/`\)/, "по чужой ссылке файл соседа не снести");
  // Осиротевший файл в бакете безвреден, битая ссылка в библиотеке — нет.
  assert.ok(route.indexOf('from("content_assets").delete()') < route.indexOf("storage.from(BUCKET).remove([path])", route.indexOf('from("content_assets").delete()')));
});
