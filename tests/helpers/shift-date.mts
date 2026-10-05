/**
 * Сдвиг часов вперёд для проверки «тесты не зависят от сегодня»:
 *   SHIFT_DAYS=60 node --import tsx --import ./tests/helpers/shift-date.mts --test tests/assortment-*.test.mts
 * Тест, который краснеет только со сдвигом, зашит на текущую дату (жёсткие даты фикстур + Date.now() в коде) и упадёт сам, без правки кода.
 */
const OFFSET = Number(process.env.SHIFT_DAYS ?? 60) * 24 * 3600 * 1000;
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

globalThis.Date = ShiftedDate as unknown as DateConstructor;
