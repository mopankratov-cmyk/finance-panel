// Виды размещения РК для журнала кампаний (см. app/wb/rk).
//
// WB говорит об этом сам — в карточке v2/adverts лежит settings.payment_type
// (cpc против cpm) и settings.placements {search, recommendations}. Раньше вид
// собирался из порядка ставки, а спорные случаи уходили в ручную разметку
// сотнями; теперь берётся факт, а разметка руками остаётся только для
// кампаний, о которых WB молчит (архив, старые записи синка).
//
// Кампания может крутиться и в поиске, и на полках одновременно — WB отдаёт
// обе площадки true. Расход между ними он не делит, поэтому такая кампания
// показывается отдельным видом «поиск + полки», а не приписывается к одному
// из них: приписать значило бы сложить чужие деньги в чужой блок.

export type WbRkBlock =
  | "cpc_search" | "cpc_shelf" | "cpc_both"
  | "cpm_search" | "cpm_shelf" | "cpm_both"
  | "erk";

export const WB_RK_BLOCKS: WbRkBlock[] = [
  "cpc_search", "cpc_shelf", "cpc_both",
  "cpm_search", "cpm_shelf", "cpm_both",
  "erk",
];

export const WB_RK_BLOCK_LABELS: Record<WbRkBlock, string> = {
  cpc_search: "CPC поиск",
  cpc_shelf: "CPC полки",
  cpc_both: "CPC поиск + полки",
  cpm_search: "CPM поиск",
  cpm_shelf: "CPM полки",
  cpm_both: "CPM поиск + полки",
  erk: "ЕРК",
};

export const WB_RK_BLOCK_UNKNOWN = "unknown";
// Не «Без разметки»: размечать руками больше нечего и нечем. Так называются
// строки кампаний, о которых WB ничего не сообщает — завершённых и удалённых,
// оставивших статистику.
export const WB_RK_BLOCK_UNKNOWN_LABEL = "Вид не определён";

export interface WbAdvertBlockInput {
  bid_type?: string | null;
  /** Модель оплаты от WB: cpc или cpm. */
  payment_type?: string | null;
  /** Площадки от WB. NULL — признак не пришёл (старая строка синка). */
  placement_search?: boolean | null;
  placement_shelf?: boolean | null;
  bid_search_rub?: number | null;
  bid_shelf_rub?: number | null;
  /** Совместимость со строками до раздельных ставок: это была ставка поиска. */
  bid_cpm_rub?: number | null;
  block_override?: string | null;
}

function isBlock(value: string | null | undefined): value is WbRkBlock {
  return WB_RK_BLOCKS.includes(value as WbRkBlock);
}

/** Модель оплаты. Слово WB сильнее любой эвристики по величине ставки. */
function payment(advert: WbAdvertBlockInput): "cpc" | "cpm" | null {
  const declared = String(advert.payment_type ?? "").trim().toLowerCase();
  if (declared === "cpc") return "cpc";
  if (declared === "cpm") return "cpm";
  // Строки, записанные синком до сбора payment_type: порядок ставки у WB
  // разводит модели надёжно — CPC это единицы рублей за клик, CPM сотни и
  // тысячи за 1000 показов. Между 60 и 120 ₽ не угадываем.
  // Ноль — это «ставка не задана», а не «ставка нулевая»: ?? пропустил бы его
  // как валидное значение и сорвал бы разбор кампании, живущей на полках.
  const bid = [advert.bid_search_rub, advert.bid_shelf_rub, advert.bid_cpm_rub]
    .find((value) => value != null && value > 0) ?? null;
  if (bid == null) return null;
  if (bid <= 60) return "cpc";
  if (bid >= 120) return "cpm";
  return null;
}

/** Площадки. Признак WB сильнее, чем «у какой ставки ненулевое значение». */
function placement(advert: WbAdvertBlockInput): "search" | "shelf" | "both" | null {
  const search = advert.placement_search;
  const shelf = advert.placement_shelf;
  if (search != null || shelf != null) {
    if (search && shelf) return "both";
    if (search) return "search";
    if (shelf) return "shelf";
    return null;
  }
  const bidSearch = advert.bid_search_rub ?? advert.bid_cpm_rub ?? null;
  const bidShelf = advert.bid_shelf_rub ?? null;
  const hasSearch = bidSearch != null && bidSearch > 0;
  const hasShelf = bidShelf != null && bidShelf > 0;
  if (hasSearch && hasShelf) return "both";
  if (hasSearch) return "search";
  if (hasShelf) return "shelf";
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

  const model = payment(advert);
  const where = placement(advert);
  if (!model || !where) return null;
  if (model === "cpc") return where === "search" ? "cpc_search" : where === "shelf" ? "cpc_shelf" : "cpc_both";
  return where === "search" ? "cpm_search" : where === "shelf" ? "cpm_shelf" : "cpm_both";
}

/** Ставка, которую показываем в строке журнала: та, что соответствует блоку. */
export function wbAdvertBlockBid(advert: WbAdvertBlockInput, block: WbRkBlock | null): number | null {
  const search = advert.bid_search_rub ?? advert.bid_cpm_rub ?? null;
  const shelf = advert.bid_shelf_rub ?? null;
  if (block === "cpc_shelf" || block === "cpm_shelf") return shelf ?? null;
  if (block === "cpc_search" || block === "cpm_search") return search ?? null;
  return search ?? shelf ?? null;
}
