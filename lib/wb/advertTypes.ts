// Виды кампаний WB по типу ставки (см. wb_adverts.bid_type).
//
// «Ручная» — ставка задаётся руками (аукцион), «единая» — автоматическое
// управление ставкой. Значения WB снимаются зондом sync-health?advert_types=1
// с живой базы, а не из анонсов: имена в документации и в API у WB расходятся.
//
// Неизвестное значение НЕ приписывается ни к одной группе: лучше честный счётчик
// «не классифицировано» в note, чем тихо раздутая чужая группа.

export type WbBidTypeGroup = "manual" | "unified";

const MANUAL_VALUES = new Set(["manual", "cpm", "auction"]);
const UNIFIED_VALUES = new Set(["auto", "unified", "automatic"]);

export function wbBidTypeGroup(raw: string | null | undefined): WbBidTypeGroup | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (MANUAL_VALUES.has(value)) return "manual";
  if (UNIFIED_VALUES.has(value)) return "unified";
  return null;
}

export const WB_BID_TYPE_GROUP_LABELS: Record<WbBidTypeGroup, string> = {
  manual: "Ручная",
  unified: "Единая",
};
