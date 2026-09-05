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
