// Виды размещения РК для журнала кампаний (см. app/wb/rk).
//
// Владелец разносит кампании по пяти секциям: CPC поиск, CPC полки, CPM поиск,
// CPM полки и ЕРК. WB прямого поля «вид размещения» не отдаёт, поэтому вид
// собирается из того, что в API есть:
//   • bid_type — manual против unified (значения сняты с живой базы зондом
//     sync-health?advert_types=1: manual 737, unified 431, unknown 5);
//   • bids_kopecks.search / .recommendations — ставка в поиске и на полках.
//     Кампания, у которой WB отдаёт только полочную ставку, крутится на полках.
//
// Модель оплаты (клики против показов) отдельным полем не приходит, но она
// однозначно читается по порядку ставки: CPC у WB — единицы рублей за клик,
// CPM — сотни и тысячи рублей за 1000 показов. Граница взята с запасом в обе
// стороны, поэтому попадание в неё считается неопределённостью, а не догадкой.
//
// Неопределённое размещение НЕ приписывается к блоку: строка уходит в «Без
// разметки», где владелец расставляет вид вручную (wb_adverts.block_override).
// Тихо раздутый чужой блок хуже честного счётчика неразмеченных кампаний.

export type WbRkBlock = "cpc_search" | "cpc_shelf" | "cpm_search" | "cpm_shelf" | "erk";

export const WB_RK_BLOCKS: WbRkBlock[] = ["cpc_search", "cpc_shelf", "cpm_search", "cpm_shelf", "erk"];

export const WB_RK_BLOCK_LABELS: Record<WbRkBlock, string> = {
  cpc_search: "CPC поиск",
  cpc_shelf: "CPC полки",
  cpm_search: "CPM поиск",
  cpm_shelf: "CPM полки",
  erk: "ЕРК",
};

export const WB_RK_BLOCK_UNKNOWN = "unknown";
export const WB_RK_BLOCK_UNKNOWN_LABEL = "Без разметки";

/** Ставка ниже — оплата за клик, выше — за 1000 показов. Между — не знаем. */
const CPC_MAX_RUB = 60;
const CPM_MIN_RUB = 120;

export interface WbAdvertBlockInput {
  bid_type?: string | null;
  bid_search_rub?: number | null;
  bid_shelf_rub?: number | null;
  /** Совместимость со строками до раздельных ставок: это была ставка поиска. */
  bid_cpm_rub?: number | null;
  block_override?: string | null;
}

function isBlock(value: string | null | undefined): value is WbRkBlock {
  return WB_RK_BLOCKS.includes(value as WbRkBlock);
}

function payment(bid: number): "cpc" | "cpm" | null {
  if (bid > 0 && bid <= CPC_MAX_RUB) return "cpc";
  if (bid >= CPM_MIN_RUB) return "cpm";
  return null;
}

/**
 * Вид размещения кампании. null — размечать вручную.
 * Ручная разметка владельца всегда сильнее автоматики.
 */
export function wbAdvertBlock(advert: WbAdvertBlockInput): WbRkBlock | null {
  if (isBlock(advert.block_override)) return advert.block_override;

  const type = String(advert.bid_type ?? "").trim().toLowerCase();
  if (type === "unified" || type === "auto" || type === "automatic") return "erk";

  const search = advert.bid_search_rub ?? advert.bid_cpm_rub ?? null;
  const shelf = advert.bid_shelf_rub ?? null;
  const hasSearch = search != null && search > 0;
  const hasShelf = shelf != null && shelf > 0;

  // Обе ставки живы — кампания идёт и в поиске, и на полках. Куда её отнести,
  // решает владелец: делить расход кампании между блоками WB не даёт.
  if (hasSearch === hasShelf) return null;

  const bid = (hasSearch ? search : shelf) as number;
  const model = payment(bid);
  if (!model) return null;
  if (hasSearch) return model === "cpc" ? "cpc_search" : "cpm_search";
  return model === "cpc" ? "cpc_shelf" : "cpm_shelf";
}

/** Ставка, которую показываем в строке журнала: та, что соответствует блоку. */
export function wbAdvertBlockBid(advert: WbAdvertBlockInput, block: WbRkBlock | null): number | null {
  const search = advert.bid_search_rub ?? advert.bid_cpm_rub ?? null;
  const shelf = advert.bid_shelf_rub ?? null;
  if (block === "cpc_shelf" || block === "cpm_shelf") return shelf ?? null;
  if (block === "cpc_search" || block === "cpm_search") return search ?? null;
  return search ?? shelf ?? null;
}
