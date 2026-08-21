// Переключение активного кабинета WB внутри одного логина.
//
// Проверено на живой сессии 21.08.2026: у seller.wildberries.ru активного
// продавца задаёт кука `x-supplier-id` (и её пара `x-supplier-id-external`),
// а её значение — это ровно `seller_id` кабинета в нашей панели. Селектор
// магазина вверху справа делает то же самое.
//
// Почему это важно: все кабинеты владельца живут в ОДНОМ логине WB. Без
// переключения сборщик пять раз снял бы один и тот же кабинет — и каждый
// снимок выглядел бы законным, просто с чужим cabinetId в ключе. Это ровно
// тот класс тихой ошибки, ради которого здесь всё построено fail-closed.

const WB_SUPPLIER_COOKIES = ["x-supplier-id", "x-supplier-id-external"];

/** Куки переключения кабинета для цели; пустой список — переключать нечем. */
export function supplierCookiesFor(target) {
  const supplierId = String(target?.supplierId ?? "").trim();
  if (!supplierId || target?.marketplace !== "wb") return [];
  return WB_SUPPLIER_COOKIES.map((name) => ({
    name,
    value: supplierId,
    domain: ".wildberries.ru",
    path: "/",
  }));
}

/**
 * Кабинет, который браузер считает активным сейчас.
 * @returns {string | null} null — куки нет (не входили или WB её не ставит)
 */
export function activeSupplierId(cookies) {
  const match = (Array.isArray(cookies) ? cookies : []).find((cookie) => cookie?.name === "x-supplier-id");
  const value = String(match?.value ?? "").trim();
  return value || null;
}

/**
 * Сверка после перехода: если WB не принял переключение, снимать нельзя —
 * иначе чужие деньги уедут в календарь под именем этого кабинета.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifySupplierSwitch(target, cookies) {
  const expected = String(target?.supplierId ?? "").trim();
  if (!expected || target?.marketplace !== "wb") return { ok: true };
  const actual = activeSupplierId(cookies);
  if (actual === expected) return { ok: true };
  return {
    ok: false,
    reason: actual
      ? `WB оставил активным кабинет ${actual}, а нужен ${expected} — снимок пропущен, чтобы не приписать чужие выплаты`
      : `WB не отдал куку x-supplier-id — профиль, похоже, не авторизован`,
  };
}
