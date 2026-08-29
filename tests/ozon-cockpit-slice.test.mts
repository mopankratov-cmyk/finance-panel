import { strict as assert } from "node:assert";
import { test } from "node:test";

/**
 * Регрессия на «чужие цифры под новой шапкой».
 *
 * Хук держит снимок вместе с ключом среза (экран + кабинет + период). Пока
 * ответ нового среза не пришёл, отдавать данные прежнего нельзя: при
 * переключении кабинета экран пятнадцать секунд показывал экономику
 * предыдущего кабинета, уже подписанную именем нового.
 *
 * Проверяем саму логику соответствия — так же, как её считает useOzonCockpit.
 */
const sliceKey = (view: string, cabinet: string, from: string, to: string) =>
  [view, cabinet, from, to, "", "{}"].join("|");

const visibleData = <T,>(snapshot: { key: string; data: T } | null, currentKey: string) =>
  snapshot?.key === currentKey ? snapshot.data : null;

test("данные прежнего кабинета не показываются под новым срезом", () => {
  const cosmos = sliceKey("economy", "cosmos", "2026-08-17", "2026-08-30");
  const bags = sliceKey("economy", "bags", "2026-08-17", "2026-08-30");
  const snapshot = { key: cosmos, data: { profit: 3_391_121 } };

  assert.deepEqual(visibleData(snapshot, cosmos), { profit: 3_391_121 });
  assert.equal(visibleData(snapshot, bags), null, "после смены кабинета — скелетон, а не чужая прибыль");
});

test("смена периода тоже меняет срез", () => {
  const month = sliceKey("sales", "cosmos", "2026-08-01", "2026-08-29");
  const twoWeeks = sliceKey("sales", "cosmos", "2026-08-17", "2026-08-30");
  const snapshot = { key: month, data: { revenue: 14_949_047 } };

  assert.equal(visibleData(snapshot, twoWeeks), null);
});

test("повторная загрузка того же среза сохраняет данные на экране", () => {
  const key = sliceKey("overview", "cosmos", "2026-08-17", "2026-08-30");
  const snapshot = { key, data: { revenue: 8_917_784 } };
  // Ошибка обновления не должна стирать уже показанный экран: данные те же,
  // ключ тот же — сверху появляется полоса «показаны прежние данные».
  assert.deepEqual(visibleData(snapshot, key), { revenue: 8_917_784 });
});
