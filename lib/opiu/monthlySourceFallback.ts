import type { OpiuCompanyOption } from "./companyScope";
import type { MarketplaceMonthlyActual } from "./monthlyStatement";
import type { MonthlyMarketplaceSource } from "./monthlyMarketplaceSources";

export interface MonthlyFactsSource {
  shared?: MarketplaceMonthlyActual["shared"];
  companies?: OpiuCompanyOption[];
}

export interface MonthlySourceResult<T> {
  data: T | null;
  error: string | null;
}

export interface CombinedMonthlySources extends MarketplaceMonthlyActual {
  companies?: OpiuCompanyOption[];
  sources?: MonthlyMarketplaceSource[];
}

export function combineMonthlySources(
  marketplaces: MonthlySourceResult<MarketplaceMonthlyActual>,
  facts: MonthlySourceResult<MonthlyFactsSource>,
): { data: CombinedMonthlySources | null; error: string | null } {
  if (!marketplaces.data && !facts.data) {
    return {
      data: null,
      error: [marketplaces.error, facts.error].filter(Boolean).join(". ") || "Не удалось загрузить ОПиУ",
    };
  }
  return {
    data: {
      ...(marketplaces.data ?? {}),
      shared: facts.data?.shared,
      companies: facts.data?.companies,
    },
    error: null,
  };
}
