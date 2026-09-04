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

/** Откуда взялось списание — `doc_type` движения. Коррекция прихода пишет брак
 *  своим видом документа: в журнале брака он должен читаться не как «списание
 *  руками», а как правка принятой партии. */
export const WRITEOFF_SOURCE: Record<string, string> = {
  purchase_receipt: "брак при приёмке",
  writeoff: "списание",
  receipt_correction: "коррекция прихода",
  return: "брак в возврате",
  // Сторно списания пишет те же строки с плюсом и тем же kind — в журнале брака
  // оно видно как отдельная строка «вернули в остаток».
  reversal: "сторно",
};

export function writeoffSource(docType: string | null): string {
  if (!docType) return "—";
  return WRITEOFF_SOURCE[docType] ?? docType;
}

/** Пояснение к расчётной себестоимости: список кодов через запятую. */
export function costNote(value: string | null): string | null {
  if (!value) return null;
  const parts = value.split(",").map((code) => COST_NOTES[code.trim()] ?? code.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : null;
}
