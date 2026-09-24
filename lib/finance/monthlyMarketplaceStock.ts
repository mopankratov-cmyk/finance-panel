export interface MarketplaceStockInput {
  article: string;
  name?: string | null;
  quantity: number;
}

export interface MarketplaceUnitCost {
  article: string;
  costRub: number;
  packagingRub: number;
}

export interface ValuedMarketplaceStock {
  article: string;
  name: string;
  quantity: number;
  costRub: number | null;
  packagingRub: number | null;
  unitValue: number | null;
  totalValue: number | null;
}

const MOSCOW_CLOCK = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const key = (value: unknown) => String(value ?? "").normalize("NFKC").trim().toLocaleUpperCase("ru-RU");
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function moscowMonthSnapshot(now: Date): { allowed: boolean; month: string; date: string; time: string } {
  const parts = Object.fromEntries(MOSCOW_CLOCK.formatToParts(now).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  return {
    allowed: parts.day === "01" && parts.hour === "00" && parts.minute === "01",
    month: `${parts.year}-${parts.month}-01`,
    date,
    time,
  };
}

/** Количество агрегируется по артикулу, стоимость фиксируется именно на дату снимка. */
export function valueMarketplaceStocks(
  stocks: readonly MarketplaceStockInput[],
  costs: readonly MarketplaceUnitCost[],
): ValuedMarketplaceStock[] {
  const costByArticle = new Map(costs.map((item) => [key(item.article), item]));
  const grouped = new Map<string, { article: string; name: string; quantity: number }>();
  for (const stock of stocks) {
    const article = String(stock.article ?? "").normalize("NFKC").trim();
    const normalized = key(article);
    const quantity = Number(stock.quantity);
    if (!normalized || !Number.isFinite(quantity) || quantity <= 0) continue;
    const current = grouped.get(normalized) ?? { article, name: String(stock.name ?? "").trim() || article, quantity: 0 };
    current.quantity += quantity;
    grouped.set(normalized, current);
  }
  return [...grouped.entries()].map(([normalized, stock]) => {
    const cost = costByArticle.get(normalized);
    const costRub = cost && cost.costRub > 0 ? cost.costRub : null;
    const packagingRub = costRub === null ? null : Math.max(0, Number(cost?.packagingRub ?? 0));
    const unitValue = costRub === null ? null : round2(costRub + (packagingRub ?? 0));
    return {
      ...stock,
      quantity: round2(stock.quantity),
      costRub,
      packagingRub,
      unitValue,
      totalValue: unitValue === null ? null : round2(unitValue * stock.quantity),
    };
  }).sort((left, right) => left.article.localeCompare(right.article, "ru"));
}
