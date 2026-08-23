/** Коды причин из SQL-функций и их русские подписи.
 *  Тексты живут здесь, а не в базе: русские литералы внутри миграций доезжали
 *  до Postgres битыми, а так кодировка вообще не участвует — и формулировку
 *  можно поправить без миграции. */

const WRITEOFF_REASONS: Record<string, string> = {
  defect_on_receipt: "брак при приёмке",
  defect_on_return: "брак в возврате",
};

const COST_NOTES: Record<string, string> = {
  no_order: "приёмка без заказа фабрике",
  price_from_card: "цена взята из карточки товара",
  no_rate: "нет курса для валюты цены фабрики",
  missing_price: "у части позиций нет цены",
  unknown_extra: "расход в валюте без курса не учтён",
};

/** Причина списания: код — на русский, человеческий текст — как есть. */
export function writeoffReason(value: string | null): string {
  if (!value) return "—";
  return WRITEOFF_REASONS[value] ?? value;
}

/** Пояснение к расчётной себестоимости: список кодов через запятую. */
export function costNote(value: string | null): string | null {
  if (!value) return null;
  const parts = value.split(",").map((code) => COST_NOTES[code.trim()] ?? code.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : null;
}
