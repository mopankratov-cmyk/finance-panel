type StockProductReference = {
  sku: string | number;
  article: string;
};

function normalized(value: string | number | null | undefined) {
  return String(value ?? "").trim();
}

/**
 * Ozon returns the same product identity through several APIs. The stock API is
 * the most reliable fallback because every stock row already carries both SKU
 * and the seller article (offer_id), even when the product catalogue is stale.
 */
export function indexOzonOfferIdsBySku(rows: readonly StockProductReference[]) {
  const result = new Map<string, string>();
  for (const row of rows) {
    const sku = normalized(row.sku);
    const offerId = normalized(row.article);
    if (sku && offerId) result.set(sku, offerId);
  }
  return result;
}

export function resolveOzonOfferId(
  sku: string | number,
  catalogueOfferIds: Readonly<Record<string, string>>,
  stockOfferIds: ReadonlyMap<string, string>,
) {
  const normalizedSku = normalized(sku);
  return normalized(catalogueOfferIds[normalizedSku]) || stockOfferIds.get(normalizedSku) || "";
}
