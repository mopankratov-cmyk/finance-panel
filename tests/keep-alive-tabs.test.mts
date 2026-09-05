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
  // Механизм сменился 05.09.2026. Перенос бейджей защищал от выезда ВБОК, но
  // растил высоту: строка занимала два уровня вместо одного, содержимое
  // доходило до 82px в семидесятишестипиксельной строке и ложилось на
  // соседнюю. Теперь ширину держит обрезка, а высоту — одна константа.
  assert.doesNotMatch(source, /flex flex-wrap items-center gap-x-1\.5 gap-y-1/, "перенос снова растит высоту строки");
  assert.match(source, /<div className="flex items-center gap-x-1\.5 overflow-hidden">/, "первый уровень обрезается по ширине");
  assert.match(source, /min-w-0 truncate text-\[11px\] font-bold text-slate-800/, "длинный артикул укорачивается, а не ломает сетку");
  // Ширина числовой колонки — величина настраиваемая (её ужимали, чтобы вернуть
  // место артикулу), поэтому сторож держит СВОЙСТВА, а не конкретные пиксели:
  // колонка фиксированной ширины, не сжимается и обрезает себя.
  assert.match(source, /w-\[\d+px\] shrink-0 overflow-hidden text-right/, "правая колонка не выливается за край");
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
  assert.match(source, /isPanelOwned\(item\.url\)/, "корзина только на том, чем распоряжается панель");
  assert.match(source, /window\.confirm/, "удаление файла необратимо — спрашиваем");

  const route = read("../app/api/content/upload/route.ts");
  assert.match(route, /hasCabinetAccess\(cabinetId\)/, "чужой кабинет");
  assert.match(route, /if \(!isPanelOwned\(target\)\)/, "чужие файлы удалять нельзя");
  // Две папки — две проверки принадлежности, потому что устроены они по-разному.
  // Загрузка с экрана несёт кабинет в пути; обложка лежит по covers/<артикул>/
  // и кабинета в пути не имеет — для неё «твой ли файл» это «твой ли товар».
  assert.match(route, /target\.includes\(`\/\$\{PREFIX\}\/\$\{cabinetId\}\/`\)/, "по чужой ссылке файл соседа не снести");
  assert.match(route, /from\("wb_cards"\)[\s\S]{0,120}eq\("article", article\)/, "обложку чужого товара удалить нельзя");
  // Папки завода (gen/, prepared/) остаются нетронутыми: у них свой репозиторий
  // и свои ссылки на эти файлы, снести их отсюда значило бы сломать соседа молча.
  const usability = read("../lib/content/assetUsability.ts");
  assert.match(usability, /isPanelUpload\(url\) \|\| isPanelCover\(url\)/, "владение панели — ровно две папки");
  // Осиротевший файл в бакете безвреден, битая ссылка в библиотеке — нет.
  assert.ok(route.indexOf('from("content_assets").delete()') < route.indexOf("storage.from(BUCKET).remove([path])", route.indexOf('from("content_assets").delete()')));
});

/**
 * Экран тестов вёл три полосы управления на три элемента: строка-описание с
 * двумя цветными кнопками, секция «Новый тест» ради одной кнопки и ниже —
 * переключатель типа отдельными кнопками. Главный переключатель стоял
 * последним и выглядел слабее периода рядом.
 */
test("экран тестов управляется одной панелью", () => {
  const source = read("../components/wb/WbCtrPage.tsx");
  // Заголовок «Новый тест» остаётся у мастера — там он к месту. Проверяем, что
  // исчезла ОТДЕЛЬНАЯ секция ради одной кнопки на самом экране.
  assert.doesNotMatch(source, /<div className="flex items-center gap-2 text-sm font-bold text-slate-800"><Plus/, "секция ради одной кнопки убрана");
  assert.doesNotMatch(source, /SKU подходят по ориентиру Inferno/);
  assert.doesNotMatch(source, /как в Inferno/, "описание продукта в рабочем интерфейсе");
  assert.match(source, /role="tablist" aria-label="Тип теста"/);
  // Тип теста нарисован тем же сегментированным контролом, что и период.
  // Высоту проверяем как свойство, а не как точную строку: на касании
  // переключатель обязан быть не ниже 44px, на большом экране остаётся
  // плотным — конкретный брейкпоинт для теста несущественен.
  const tablist = source.match(/className="([^"]*)" role="tablist"/)?.[1] ?? "";
  assert.match(tablist, /rounded-lg border border-slate-200 bg-white p-0\.5 shadow-sm/);
  assert.match(tablist, /min-h-11/, "переключатель типа теста ниже 44px — пальцем не попасть");
});

test("заголовок не обещает CTR, когда открыт другой тип теста", () => {
  const source = read("../components/wb/WbCtrPage.tsx");
  assert.doesNotMatch(source, /title="Тестирование CTR"/);
  assert.match(source, /typeTabs\.find\(\(tab\) => tab\.value === type\)\?\.note/);
  for (const note of ["кликабельность обложки", "конверсия карточки", "заказы к открытиям"]) {
    assert.ok(source.includes(note), note);
  }
});

test("счётчик кандидатов склоняется и объясняет свой порог там, где он применён", () => {
  const source = read("../components/wb/WbCtrPage.tsx");
  assert.doesNotMatch(source, /\{eligibleCount\} SKU подходят/, "«1 SKU подходят»");
  assert.match(source, /plural\(eligibleCount, "товар подходит", "товара подходят", "товаров подходят"\)/);
  assert.match(source, /Кандидат — от 1 000 показов и CTR ниже 3%/);
});

test("нижняя плашка говорит по-человечески, а не именем флага", () => {
  const source = read("../components/wb/WbCtrPage.tsx");
  assert.doesNotMatch(source, /live_swap_enabled/, "имя флага в коде — не текст для человека");
  assert.doesNotMatch(source, /proxy «заказы \/ открытия»/);
  // Обещание изменилось вместе с продуктом: автоматическая смена появилась,
  // и плашка обязана называть, КТО меняет фото, а не отрицать саму смену.
  assert.match(source, /<b className="text-slate-700">Кто меняет фото\.<\/b>/);
  assert.match(source, /Запись в карточку необратима/);
});
