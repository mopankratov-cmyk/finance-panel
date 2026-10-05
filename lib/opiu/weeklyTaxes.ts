import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { readCompaniesCompat } from "@/lib/finance/companySchema";
import { parseCompanyTaxRate, parseCompanyTaxSystem, parseCompanyVatMode } from "@/lib/finance/companyTax";
import { grossProfitOf } from "./buildReport";
import { buildOpiuCompanyScopes, companyNamesMatch, type OpiuCompanyOption } from "./companyScope";
import type { OpiuBrand } from "./constants";
import type { WeekRawMetrics } from "./metrics";
import { wbBrandCompanyName } from "./monthlyMarketplaceSources";
import { monthlyTaxSettingGaps, withCalculatedMonthlyTaxes } from "./monthlyTaxFacts";

/**
 * Налог и НДС недельного «Финансового отчёта WB» считаются ПО ТЕМ ЖЕ правилам
 * и настройкам компаний, что и в месячном ОПиУ (monthlyTaxFacts.ts), чтобы
 * недели и месяц не расходились:
 *  - база — «Выручка с учётом СПП» (то, что заплатил покупатель);
 *  - НДС — исходящий НДС, уже входящий в цену: база × ставка / (100 + ставка),
 *    входной НДС не вычитается;
 *  - налог — для УСН/АвтоУСН «Доходы» база × ставка; для «Доходы минус
 *    расходы» — от Валовой прибыли (с минимумом от выручки).
 * Это расчётная оценка до бухгалтерского закрытия, не фактическая уплата.
 */
export function weeklyTaxAmounts(
  metrics: WeekRawMetrics,
  company: OpiuCompanyOption,
): { tax: number; vat: number } {
  const shared = withCalculatedMonthlyTaxes({
    company,
    marketplaceTaxBase: metrics.revenue,
    ebitda: grossProfitOf(metrics),
  });
  return { tax: shared?.taxes?.amount ?? 0, vat: shared?.vat?.amount ?? 0 };
}

/** Проставляет налог и НДС в недельные метрики одного бренда. Без компании возвращает как есть. */
export function withWeeklyTaxes(
  weeks: WeekRawMetrics[],
  company: OpiuCompanyOption | undefined,
): WeekRawMetrics[] {
  if (!company) return weeks;
  return weeks.map((week) => ({ ...week, ...weeklyTaxAmounts(week, company) }));
}

/** Чего не хватает в налоговых настройках юрлица бренда ("ИП X: ставка налога"). Пусто — всё заполнено. */
export function brandTaxGaps(
  brand: Pick<OpiuBrand, "id" | "entity">,
  company: OpiuCompanyOption | undefined,
): string[] {
  const name = wbBrandCompanyName(brand);
  if (!company) return [`${name}: компания не найдена в разделе «Компании»`];
  const gaps = monthlyTaxSettingGaps(company);
  return gaps.length ? [`${name}: ${gaps.join(", ")}`] : [];
}

/**
 * Компания с налоговыми настройками для каждого бренда — по юрлицу бренда
 * (wbBrandCompanyName), с тем же объединением исторических алиасов, что и в
 * месячном ОПиУ. Таблица читается с учётом отставшей схемы (readCompaniesCompat).
 * Не нашли компанию / не прочитали — в карте будет undefined, и отчёт покажет
 * предупреждение вместо молчаливого нуля.
 */
export async function loadBrandTaxCompanies(
  brands: readonly OpiuBrand[],
): Promise<Map<string, OpiuCompanyOption | undefined>> {
  const byBrand = new Map<string, OpiuCompanyOption | undefined>(brands.map((brand) => [brand.id, undefined]));
  const db = getSupabaseAdmin();
  if (!db) return byBrand;

  const loaded = await readCompaniesCompat((columns) => db.from("companies").select(columns));
  if (loaded.result.error) {
    console.error("[opiu] companies read:", loaded.result.error.message);
    return byBrand;
  }

  const scopes = buildOpiuCompanyScopes((loaded.result.data ?? []).map((raw) => {
    const row = raw as unknown as Record<string, unknown>;
    return {
      id: String(row.id),
      name: String(row.name),
      groupName: String(row.group_name ?? ""),
      isActive: Boolean(row.is_active),
      ...(loaded.taxSettingsAvailable ? {
        taxSystem: parseCompanyTaxSystem(row.tax_system) ?? null,
        vatMode: parseCompanyVatMode(row.vat_mode) ?? null,
      } : {}),
      ...(loaded.taxRatesAvailable ? {
        taxRate: parseCompanyTaxRate(row.tax_rate) ?? null,
        taxAdditionalRate: parseCompanyTaxRate(row.tax_additional_rate) ?? null,
      } : {}),
    };
  }));

  for (const brand of brands) {
    const name = wbBrandCompanyName(brand);
    const scope = scopes.find((candidate) => companyNamesMatch(candidate.name, name));
    if (!scope) continue;
    byBrand.set(brand.id, {
      id: scope.id,
      name: scope.name,
      groupName: scope.groupName,
      taxSystem: scope.taxSystem,
      vatMode: scope.vatMode,
      taxRate: scope.taxRate,
      taxAdditionalRate: scope.taxAdditionalRate,
    });
  }
  return byBrand;
}
