// Карточки собственного кабинета целиком, без товарного контура.
//
// Контур брендов (brand_filters) придуман для агентских кабинетов, где рядом с
// нашими лежат карточки чужих продавцов. В собственном кабинете он бы отсёк
// половину настоящего ассортимента: у Retail Family фильтр стоит на norvia, а в
// кабинете живут ещё сумки, косметика и медтекстиль — и всё это наше.

import { fetchWbCardPages } from "@/lib/wb/cardPagination";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";

export interface CabinetCard {
  nmId: number;
  article: string;
  brand: string;
  title: string;
  createdAt: string | null;
}

interface RawCard {
  nmID?: number;
  vendorCode?: string;
  brand?: string;
  title?: string;
  createdAt?: string;
}

/** Потолок обхода: 100 карточек на страницу × 80 страниц. */
const MAX_PAGES = 80;

export async function readCabinetCards(
  cabinetId: string,
): Promise<{ cards: CabinetCard[]; complete: boolean }> {
  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return { cards: [], complete: true };
  const page = await fetchWbCardPages<RawCard>({
    token: resolveWbToken(cabinet, "content"),
    maxPagesThisRun: MAX_PAGES,
  });
  const cards: CabinetCard[] = [];
  for (const card of page.rows) {
    const nmId = Number(card.nmID);
    cards.push({
      nmId: Number.isFinite(nmId) ? nmId : 0,
      article: String(card.vendorCode ?? "").trim(),
      brand: String(card.brand ?? "").trim(),
      title: String(card.title ?? "").trim(),
      createdAt: card.createdAt ?? null,
    });
  }
  return { cards, complete: page.caughtUp };
}
