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

// У Ozon активный кабинет лежит в куке sc_company_id, и её значение — это
// client_id кабинета в панели (проверено 21.08: sc_company_id=1933484 при
// входе под CLERIN). Без этой сверки сбор молча снял выплаты CLERIN и отдал
// их ещё и под именем COSMOS — ровно то, от чего защищает WB-проверка.
const CABINET_COOKIES = {
  wb: { names: ["x-supplier-id", "x-supplier-id-external"], read: "x-supplier-id", domain: ".wildberries.ru", key: "supplierId" },
  ozon: { names: ["sc_company_id"], read: "sc_company_id", domain: ".ozon.ru", key: "sellerId" },
};

function cabinetIdOf(target) {
  const rules = CABINET_COOKIES[target?.marketplace];
  if (!rules) return null;
  const value = String(target?.[rules.key] ?? "").trim();
  return value || null;
}

/** Куки переключения кабинета для цели; пустой список — переключать нечем. */
export function supplierCookiesFor(target) {
  const rules = CABINET_COOKIES[target?.marketplace];
  const value = cabinetIdOf(target);
  if (!rules || !value) return [];
  return rules.names.map((name) => ({ name, value, domain: rules.domain, path: "/" }));
}

/**
 * Кабинет, который браузер считает активным сейчас.
 * @returns {string | null} null — куки нет (не входили или маркетплейс её не ставит)
 */
export function activeSupplierId(cookies, marketplace = "wb") {
  const rules = CABINET_COOKIES[marketplace];
  if (!rules) return null;
  const match = (Array.isArray(cookies) ? cookies : []).find((cookie) => cookie?.name === rules.read);
  const value = String(match?.value ?? "").trim();
  return value || null;
}

/**
 * Сверка после перехода: если WB не принял переключение, снимать нельзя —
 * иначе чужие деньги уедут в календарь под именем этого кабинета.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifySupplierSwitch(target, cookies) {
  const expected = cabinetIdOf(target);
  // Кабинет не назван — сверять нечем. Тогда цель обязана быть единственной в
  // своём профиле, иначе снимок уедет под чужим именем.
  if (!expected) return { ok: true };
  const marketplace = target.marketplace === "ozon" ? "Ozon" : "WB";
  const actual = activeSupplierId(cookies, target.marketplace);
  if (actual === expected) return { ok: true };
  return {
    ok: false,
    reason: actual
      ? `${marketplace} оставил активным кабинет ${actual}, а нужен ${expected} — снимок пропущен, чтобы не приписать чужие выплаты`
      : `${marketplace} не отдал куку активного кабинета — профиль, похоже, не авторизован`,
  };
}
