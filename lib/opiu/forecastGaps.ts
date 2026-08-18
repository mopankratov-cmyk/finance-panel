// §9. Вместо общего «для N артикулов нет данных» — детализация по каждому
// артикулу: чего не хватает, откуда ожидались данные и влияет ли отсутствие
// на ВЫПЛАТУ (перечисление маркетплейса) или только на ПРИБЫЛЬ (себестоимость).
// §19: неполные денежные параметры нельзя выдавать за полный итог, поэтому
// affectsPayout помечает строки, которые делают итог выплаты неполным.

export type ForecastGapImpact = "payout" | "profit";

export interface ForecastGap {
  /** Чего не хватает (человеко-читаемо). */
  field: string;
  /** Из какого источника ожидались данные. */
  source: string;
  /** Влияет на выплату маркетплейса или только на расчёт прибыли. */
  impact: ForecastGapImpact;
}

/**
 * Наличие экономических компонентов у артикула.
 * `undefined` — компонент ещё не оценивается на этой фазе (не считается пробелом);
 * `false` — данных нет (пробел); `true` — данные есть.
 */
export interface ForecastArticleEconomicsPresence {
  planRevenue: number;
  payoutRate: number | null;
  commission?: boolean;
  logistics?: boolean;
  storage?: boolean;
  acquiring?: boolean;
  cost?: boolean;
}

export interface ForecastArticleGapResult {
  gaps: ForecastGap[];
  /** Есть ли пробел, влияющий на сумму выплаты. */
  affectsPayout: boolean;
  /** Учтён ли артикул в итоговой сумме прогноза выплаты. */
  includedInForecast: boolean;
}

export function classifyForecastArticleGaps(
  presence: ForecastArticleEconomicsPresence,
): ForecastArticleGapResult {
  const gaps: ForecastGap[] = [];

  if (!(presence.planRevenue > 0)) {
    gaps.push({
      field: "Плановая выручка (цена или процент выкупа)",
      source: "раздел «План»",
      impact: "payout",
    });
  }
  if (presence.payoutRate === null) {
    gaps.push({
      field: "Доля выплаты: нет ни истории отчётов, ни полных ставок юнит-экономики",
      source: "финансовый отчёт WB или юнит-экономика кабинета",
      impact: "payout",
    });
  }
  if (presence.commission === false) {
    gaps.push({ field: "Комиссия маркетплейса", source: "комиссии WB (wb_nm_commissions)", impact: "payout" });
  }
  if (presence.logistics === false) {
    gaps.push({ field: "Логистика", source: "юнит-экономика WB", impact: "payout" });
  }
  if (presence.storage === false) {
    gaps.push({ field: "Хранение", source: "юнит-экономика WB", impact: "payout" });
  }
  if (presence.acquiring === false) {
    gaps.push({ field: "Эквайринг", source: "юнит-экономика WB", impact: "payout" });
  }
  // Себестоимость влияет на прибыль, но НЕ вычитается из выплаты маркетплейса (§6).
  if (presence.cost === false) {
    gaps.push({ field: "Себестоимость", source: "раздел «Затраты»", impact: "profit" });
  }

  const affectsPayout = gaps.some((gap) => gap.impact === "payout");
  // Артикул попадает в сумму прогноза выплаты только если известна доля выплаты
  // и есть плановая выручка (иначе forecastPayout = null и вклад в итог нулевой).
  const includedInForecast = presence.payoutRate !== null && presence.planRevenue > 0;

  return { gaps, affectsPayout, includedInForecast };
}
