export type WbPayoutRateSource = "financial_report" | "unit_economics" | "unavailable";

export interface WbPayoutRateResolution {
  rate: number | null;
  source: WbPayoutRateSource;
}

const validRate = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

/** Prefer exact report history; otherwise use the current unit-economics rates. */
export function resolveWbPayoutRate(input: {
  historicalRevenue: number;
  historicalPayout: number;
  unitMarketplacePct: number | null;
  unitAcquiringPct: number | null;
  unitRatesAvailable: boolean;
}): WbPayoutRateResolution {
  if (Number.isFinite(input.historicalRevenue) && input.historicalRevenue > 0) {
    const historicalRate = input.historicalPayout / input.historicalRevenue;
    if (validRate(historicalRate)) return { rate: historicalRate, source: "financial_report" };
  }

  if (
    input.unitRatesAvailable
    && input.unitMarketplacePct !== null
    && input.unitAcquiringPct !== null
    && Number.isFinite(input.unitMarketplacePct)
    && Number.isFinite(input.unitAcquiringPct)
  ) {
    const unitRate = 1 - (input.unitMarketplacePct + input.unitAcquiringPct) / 100;
    if (validRate(unitRate)) return { rate: unitRate, source: "unit_economics" };
  }

  return { rate: null, source: "unavailable" };
}
