import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../components/wb/WbRkJournalPage.tsx", import.meta.url), "utf8");

test("столбец задач залит во всех своих ячейках", () => {
  // Заливка стояла только в ветке пустого дня. Где у дня есть цифры — а это
  // почти вся таблица — ячейка задачи оставалась белой, и полоса рвалась.
  const cells = [...SRC.matchAll(/<td [^>]*>\{(?:noteBadge|cBadge)\}<\/td>/g)];
  for (const cell of cells) {
    assert.match(cell[0], /TASK_CELL/, `ячейка задачи без заливки: ${cell[0]}`);
  }
  assert.ok(cells.length >= 4, `ожидалось не меньше четырёх ячеек задачи, найдено ${cells.length}`);
});

test("скрытый столбец задач не сдвигает таблицу", () => {
  // Шапка рисует «Задачу» под условием, а две ячейки в теле рисовались всегда:
  // при скрытом столбце дни разъезжались с заголовками на одну колонку.
  for (const badge of ["noteBadge", "cBadge"]) {
    const uses = [...SRC.matchAll(new RegExp(`<td[^>]*>\\{${badge}\\}</td>`, "g"))];
    for (const use of uses) {
      const before = SRC.slice(Math.max(0, use.index! - 60), use.index!);
      assert.match(before, /showNotes \?/, `ячейка ${badge} рисуется без проверки showNotes`);
    }
  }
  // Заголовок и ширина пустого дня считают одно и то же число колонок.
  assert.match(SRC, /const dayCols = showNotes \? 7 : 6;/, "ширина дня перестала зависеть от столбца задач");
});
