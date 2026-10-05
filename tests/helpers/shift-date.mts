/**
 * Сдвиг часов вперёд для проверки «тесты не зависят от сегодня»:
 *   SHIFT_DAYS=60 node --import tsx --import ./tests/helpers/shift-date.mts --test tests/assortment-*.test.mts
 * Тест, который краснеет только со сдвигом, зашит на текущую дату (жёсткие даты фикстур + Date.now() в коде) и упадёт сам, без правки кода.
 * Проверка ручная: CI гоняет набор без сдвига. Неверный SHIFT_DAYS — ошибка при загрузке помощника (см. shift-days.mts).
 */
import { parseShiftDays } from "./shift-days.mts";

const OFFSET = parseShiftDays(process.env.SHIFT_DAYS) * 24 * 3600 * 1000;
const RealDate = Date;

class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + OFFSET);
    else super(...(args as ConstructorParameters<typeof Date>));
  }

  static now(): number {
    return RealDate.now() + OFFSET;
  }
}

// Настоящий Date() без new возвращает строку; у класса такой вызов — TypeError. Подменённый «сегодня» отдаёт сдвинутым, как и new Date().
globalThis.Date = new Proxy(ShiftedDate, {
  apply: () => new RealDate(RealDate.now() + OFFSET).toString(),
}) as unknown as DateConstructor;
