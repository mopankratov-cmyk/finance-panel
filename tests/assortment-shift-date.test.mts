import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_SHIFT_DAYS, parseShiftDays } from "./helpers/shift-days.mts";

/** Помощник сдвига часов (tests/helpers/shift-date.mts): сам он должен быть честным, иначе проверка «не зависим от сегодня» идёт вхолостую. */

const root = fileURLToPath(new URL("..", import.meta.url));
const HELPER = pathToFileURL(join(root, "tests/helpers/shift-date.mts")).href;
const DAY = 24 * 3600 * 1000;
// Настоящие часы: этот же файл гоняют и со сдвигом (SHIFT_DAYS у родителя), Date.now() там уже не «сейчас».
const realNow = () => performance.timeOrigin + performance.now();

/** Дочерний процесс с подключённым помощником: подмена Date живёт только в нём, этот тест остаётся на настоящих часах. */
function runShifted(code: string, shiftDays: string | undefined) {
  const env = { ...process.env };
  if (shiftDays === undefined) delete env.SHIFT_DAYS;
  else env.SHIFT_DAYS = shiftDays;
  return spawnSync(process.execPath, ["--import", "tsx", "--import", HELPER, "-e", code], { cwd: root, env, encoding: "utf8" });
}

const PROBE = `console.log(JSON.stringify({ viaNew: new Date().getTime(), viaNow: Date.now(), call: Date(), callType: typeof Date(), fixed: new Date(2020, 0, 1).getFullYear(), isDate: new Date() instanceof Date }))`;

test("SHIFT_DAYS: не задано — 60 суток; число (в том числе 0 и отрицательное) принимается; пусто, не число и не конечное — понятная ошибка", () => {
  assert.equal(parseShiftDays(undefined), DEFAULT_SHIFT_DAYS);
  assert.equal(DEFAULT_SHIFT_DAYS, 60);
  assert.equal(parseShiftDays("7"), 7);
  assert.equal(parseShiftDays(" 12 "), 12);
  assert.equal(parseShiftDays("0"), 0, "явный ноль — осознанный выбор «без сдвига»");
  assert.equal(parseShiftDays("-3"), -3);
  assert.equal(parseShiftDays("0.5"), 0.5);
  // Пустое значение раньше давало Number("") === 0: сдвига нет, проверка проходила вхолостую.
  for (const bad of ["", "   ", "abc", "NaN", "Infinity", "-Infinity", "1e999", "60 дней"]) {
    assert.throws(() => parseShiftDays(bad), /SHIFT_DAYS=.*конечное число суток/, `«${bad}» — ошибка, а не молчаливый ноль или NaN`);
  }
});

test("Помощник сдвига: new Date() и Date.now() идут вперёд на SHIFT_DAYS, даты с аргументами не трогает, Date() без new — строка, как у настоящего", () => {
  const before = realNow();
  const run = runShifted(PROBE, "10");
  const after = realNow();
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim()) as { viaNew: number; viaNow: number; call: string; callType: string; fixed: number; isDate: boolean };
  const slack = 60_000;
  assert.ok(out.viaNew >= before + 10 * DAY - 1_000 && out.viaNew <= after + 10 * DAY + slack, "new Date() сдвинут на 10 суток");
  assert.ok(out.viaNow >= before + 10 * DAY - 1_000 && out.viaNow <= after + 10 * DAY + slack, "Date.now() сдвинут на 10 суток");
  assert.equal(out.fixed, 2020, "Date с аргументами — настоящий");
  assert.equal(out.isDate, true);
  // Раньше здесь был TypeError: Class constructor ShiftedDate cannot be invoked without 'new'.
  assert.equal(out.callType, "string", "Date() без new возвращает строку");
  const called = Date.parse(out.call);
  assert.ok(Math.abs(called - (before + 10 * DAY)) < slack, "и строка — тоже со сдвигом");
});

test("Помощник сдвига: без SHIFT_DAYS — 60 суток; неверное значение рушит загрузку с названием переменной, а не даёт NaN или нулевой сдвиг", () => {
  const before = realNow();
  const byDefault = runShifted(PROBE, undefined);
  assert.equal(byDefault.status, 0, byDefault.stderr);
  const viaNew = (JSON.parse(byDefault.stdout.trim()) as { viaNew: number }).viaNew;
  assert.ok(Math.abs(viaNew - (before + 60 * DAY)) < 60_000, "по умолчанию 60 суток");
  for (const bad of ["", "abc"]) {
    const run = runShifted(PROBE, bad);
    assert.notEqual(run.status, 0, `SHIFT_DAYS="${bad}" не должен тихо проходить`);
    assert.match(run.stderr, /SHIFT_DAYS=.*конечное число суток/);
    assert.equal(run.stdout.trim(), "", "до самой проверки дело не доходит");
  }
});
