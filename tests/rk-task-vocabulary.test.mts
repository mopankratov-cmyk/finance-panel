import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  RK_BUDGET_AMOUNTS,
  RK_NOTE_PRESETS,
  rkBudgetNote,
  rkBudgetShort,
  rkNoteShort,
  rkNoteTone,
} from "../lib/wb/rkNotes.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Словарь задач выведен из рабочей таблицы, а не придуман.
 *
 * Сверка 12.09.2026 на «Показы CTR CPC»: 4 401 решение менеджеров за август,
 * 292 разных формулировки. Прежние шесть пунктов выражали 48,5% решений —
 * остальное набивали руками либо не набивали вовсе.
 *
 * Покрытие по тому же корпусу:
 *   прежние шесть пунктов        48,5%
 *   + новые пункты списка        66,9%
 *   + сборщик бюджета            87,1%
 */

test("две самые частые задачи стоят первыми", () => {
  // Распределение крайне неровное: «откл до отгрузки» 40,4% и «откл остатки»
  // 15,5% — вместе 56% всех решений за август. Алфавит или «логический
  // порядок» здесь стоил бы двух лишних движений на каждой второй задаче.
  assert.equal(RK_NOTE_PRESETS[0].note, "Откл до отгрузки");
  assert.equal(RK_NOTE_PRESETS[1].note, "Откл остатки");
});

test("«Откл остатки» — отдельная задача, а не синоним отгрузки", () => {
  // 682 раза за август, вторая по частоте. Смысл разный: там ждут поставку,
  // здесь гасят рекламу на распродаже остатков. Сводить их в один пункт
  // значило бы потерять различие, которое менеджеры делают каждый день.
  const notes = RK_NOTE_PRESETS.map((preset) => preset.note);
  assert.ok(notes.includes("Откл остатки"));
  assert.ok(notes.includes("Откл до отгрузки"));
  assert.notEqual(rkNoteShort("Откл остатки"), rkNoteShort("Откл до отгрузки"));
});

test("час выключения задаётся осознанно", () => {
  // «Включение в 17 и отключение в 23» — 75 раз за август. Это не то же, что
  // «17:00–24:00»: разница в час поставлена руками, и подменять её нельзя.
  const notes = RK_NOTE_PRESETS.map((preset) => preset.note);
  assert.ok(notes.includes("Включение в 17:00, отключение в 23:00"));
  assert.ok(notes.includes("Работа с 17:00 - 24:00"));
  assert.equal(rkNoteShort("Включение в 17:00, отключение в 23:00"), "17–23");
  assert.equal(rkNoteShort("Работа с 17:00 - 24:00"), "17–24");
});

test("бюджет собирается, а не выкладывается пунктами", () => {
  // Сумма × площадка × биддер — это больше двадцати сочетаний. Пунктами список
  // стал бы длиннее экрана ради задачи, которая ставится раз в день.
  assert.deepEqual([...RK_BUDGET_AMOUNTS], [1_500, 2_000, 2_500, 3_000, 4_000]);
  assert.equal(rkBudgetNote({ amountRub: 2_000, placement: "all", bidder: false }), "2 000 ₽, запуск 17:00");
  assert.equal(rkBudgetNote({ amountRub: 3_000, placement: "shelf_cpm", bidder: false }), "3 000 ₽, только полки CPM");
  assert.equal(rkBudgetNote({ amountRub: 4_000, placement: "all", bidder: true }), "4 000 ₽, запуск 17:00, биддер");
});

test("задача с бюджетом узнаётся в клетке после дороги через базу", () => {
  // Текст уходит в базу строкой и возвращается ею же: если разбор обратно не
  // сойдётся, клетка потеряет и цвет, и короткую подпись.
  for (const amountRub of RK_BUDGET_AMOUNTS) {
    for (const placement of ["all", "shelf_cpm"] as const) {
      for (const bidder of [false, true]) {
        const note = rkBudgetNote({ amountRub, placement, bidder });
        assert.equal(rkNoteTone(note), "budget", note);
        assert.equal(rkNoteShort(note), rkBudgetShort({ amountRub, placement, bidder }), note);
        // В клетку влезает: две строки по 138px это примерно 24 знака.
        assert.ok(rkNoteShort(note).length <= 24, `${note} → ${rkNoteShort(note)}`);
      }
    }
  }
});

test("своя формулировка остаётся собой", () => {
  // Треть решений в таблице — свой текст. Подменять его короткой подписью
  // нельзя: там пишут то, чего в списке нет и не будет.
  assert.equal(rkNoteShort("поговорить с поставщиком"), "поговорить с поставщиком");
  assert.equal(rkNoteTone("поговорить с поставщиком"), "custom");
  // И не путаем с бюджетом: число в тексте само по себе не делает задачу бюджетной.
  assert.equal(rkNoteTone("проверить 2000 отзывов"), "custom");
});

test("у бюджета свой цвет, а не общий «прочее»", () => {
  // В столбце должно быть видно, где меняли сумму, а где режим работы.
  const page = read("../components/wb/WbRkJournalPage.tsx");
  assert.match(page, /budget: "bg-sky-100\/80 text-sky-800"/);
  assert.notEqual(rkNoteTone("2 000 ₽, запуск 17:00"), rkNoteTone("Круглосуточно"));
});

test("сборщик бюджета живёт вторым экраном, а не длинным списком", () => {
  const pick = read("../components/wb/WbRkNoteQuickPick.tsx");
  assert.match(pick, /const \[budgetMode, setBudgetMode\] = useState\(false\)/);
  assert.match(pick, /Бюджет и запуск…/);
  // Площадка и биддер — приписки к любой сумме: переключателями, иначе каждая
  // сумма размножилась бы на четыре строки.
  assert.match(pick, /setPlacement\(/);
  assert.match(pick, /setBidder\(/);
  assert.match(pick, /rkBudgetNote\(\{ amountRub: amount, placement, bidder \}\)/);
});

test("список остался коротким", () => {
  // Поповер открывается у клетки, и длинный список перестаёт помещаться на
  // экране — ради одной задачи пришлось бы прокручивать.
  assert.ok(RK_NOTE_PRESETS.length <= 10, `пунктов ${RK_NOTE_PRESETS.length}`);
  for (const preset of RK_NOTE_PRESETS) {
    assert.ok(preset.short.length <= 14, `${preset.note} → ${preset.short}`);
    assert.ok(preset.note.trim().length > 0);
  }
});

test("список задач не обрезается ни при каком размере окна", () => {
  // Высота поповера задавалась числом на глаз, и с ростом списка нижние пункты
  // уезжали за край без всякого признака, что там что-то есть. Число на глаз
  // ошибётся снова на следующем добавленном пункте — поэтому меряем.
  const pick = read("../components/wb/WbRkNoteQuickPick.tsx");
  assert.doesNotMatch(pick, /const height = .*\d{3}/, "высота списка снова задана числом");
  assert.match(pick, /useLayoutEffect/);
  assert.match(pick, /box\.scrollHeight/);
  // Вниз, вверх, а если не помещается нигде — прокрутка на всю высоту экрана.
  assert.match(pick, /setPlaced\(\{ top: gap, maxHeight: viewport - gap \* 2 \}\)/);
  assert.match(pick, /overflow-y-auto overscroll-contain rounded-xl/);
  // Пересчёт при смене экрана списка и при изменении окна.
  assert.match(pick, /\[anchor\.y, budgetMode, isPhone, mounted, note\]/);
  assert.match(pick, /addEventListener\("resize", measure\)/);
});
