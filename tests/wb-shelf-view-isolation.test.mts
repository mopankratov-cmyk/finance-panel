import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const shelf = readFileSync(new URL("../components/wb/WbShelfPage.tsx", import.meta.url), "utf8");

/**
 * «Полки / Цены» — два вида в одном экране. Загрузка полок про вид не знала:
 * открытие вкладки «Конкуренты» и КАЖДОЕ переключение периода на ней тянули
 * /api/shelf/table (самый тяжёлый запрос раздела), /api/shelf/watch и три
 * вспомогательных справочника. Нужный запрос конкурентов ждал их в очереди
 * браузера — это и ощущалось как «лагает».
 */
test("вкладка «Конкуренты» не грузит полки", () => {
  assert.match(shelf, /if \(view !== "shelf"\) \{ setLoading\(false\); return; \}/,
    "эффект полок обязан выходить на чужом виде");
  const deps = shelf.match(/\}, \[cabinetId, cabinets\.length, cabinetsError, cabinetsLoading, days, ready, retryKey[^\]]*\]\);/);
  assert.ok(deps, "не нашёл зависимости эффекта полок");
  assert.match(deps[0], /view\]/, "без view в зависимостях возврат на «Полки» не перезагрузит их");
});

test("вспомогательные справочники полок молчат на вкладке конкурентов", () => {
  assert.match(shelf, /const shelfCabinet = view === "shelf" && hasExactCabinet \? cabinetId : null;/);
  for (const hook of ["useCabinetSkuOrder", "useRnpTags", "useWbSkuNames"]) {
    assert.match(shelf, new RegExp(`${hook}\\(shelfCabinet\\)`), hook);
  }
});

test("индикатор загрузки не залипает на вкладке конкурентов", () => {
  // Кнопка «Обновить» дизейблится по loading. Ранний выход без setLoading(false)
  // оставил бы её вечным спиннером на второй вкладке.
  const guard = shelf.indexOf('if (view !== "shelf")');
  assert.ok(guard > 0);
  assert.match(shelf.slice(guard, guard + 80), /setLoading\(false\)/);
});
