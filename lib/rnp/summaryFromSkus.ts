// Пересборка «Общей сводки» РНП из отфильтрованного набора SKU (бренд,
// категория, теги, список артикулов, «сгоревшие», «потери»). Серверная сводка
// считается по всему кабинету из сырых строк; на клиенте повторяем те же
// формулы над метриками выбранных SKU: суммы складываются, производные
// пересчитываются из сумм — НЕ усредняются по строкам (среднее из процентов
// исказило бы агрегат). Формулы сверены с lib/rnp/buildTable.ts и
// lib/rnp/taxMetrics.ts — расхождение сторожит тест rnp-summary-from-skus.

interface MetricParts {
  numerator: (number | null)[];
  denominator: (number | null)[];
  scale: 100 | 1;
}

interface BaseMetric {
  field: string;
  kind: string;
  daily: (number | null)[];
  total: number | null;
  forecast: number | null;
  /** Числитель и знаменатель производной, которых нет среди строк таблицы. */
  parts?: MetricParts;
}

type Get = (field: string) => number | null;

const r1 = (value: number) => Math.round(value * 10) / 10;

function pctOf(num: number | null, den: number | null): number | null {
  return num != null && den != null && den > 0 ? r1((num / den) * 100) : null;
}

function perUnit(num: number | null, den: number | null): number | null {
  return num != null && den != null && den > 0 ? Math.round(num / den) : null;
}

/** Производные, которые пересчитываются только из своих `parts`. */
const PARTS_ONLY_FIELDS = new Set(["actual_buyout_pct", "cohort_resolved_pct", "logistics_per_unit"]);

// Производные из СУММ выбранных SKU — формулы buildTable/taxMetrics один в один.
const RATIO_RULES: Record<string, (g: Get) => number | null> = {
  ctr: (g) => pctOf(g("clicks"), g("views")),
  cart_cr: (g) => pctOf(g("cart"), g("open_card")),
  order_cr: (g) => pctOf(g("orders_count"), g("open_card")),
  org_cr_pct: (g) => pctOf(g("org_orders_count"), g("org_open_card")),
  org_share_pct: (g) => pctOf(g("org_open_card"), g("open_card")),
  buyout_pct: (g) => pctOf(g("buyouts_count"), g("orders_count")),
  // Доля отмен — к ОФОРМЛЕННЫМ заказам, то есть к сумме «дошедшие + отменённые»
  // (так же считает сервер, buildTable). Деление на одни дошедшие завышало
  // процент, и под фильтром он расходился с той же строкой без фильтра.
  cancel_pct: (g) => {
    const cancels = g("cancels_count");
    const orders = g("orders_count");
    return cancels != null && orders != null ? pctOf(cancels, cancels + orders) : null;
  },
  return_pct: (g) => pctOf(g("returns_count"), g("buyouts_gross_count")),
  // actual_buyout_pct, cohort_resolved_pct и logistics_per_unit пересчитываются
  // из своих `parts` (когорта заказов, логистика финотчёта) — см. ниже.
  fbs_share_pct: (g) => {
    const fbs = g("orders_fbs_sum");
    const known = (fbs ?? 0) + (g("orders_fbw_sum") ?? 0);
    return fbs != null && known > 0 ? r1((fbs / known) * 100) : null;
  },
  drr: (g) => pctOf(g("ad_spent"), g("orders_sum")),
  romi: (g) => pctOf(g("gross"), g("ad_spent")),
  gmroi: (g) => {
    const value = pctOf(g("gross"), g("money"));
    return value == null ? null : Math.min(999, value);
  },
  avg_order_price: (g) => perUnit(g("orders_sum"), g("orders_count")),
  avg_buyout_price: (g) => perUnit(g("buyouts_sum"), g("buyouts_count")),
  profit_per_unit: (g) => perUnit(g("gross"), g("buyouts_count")),
};

type At = (metric: BaseMetric) => number | null;

// Метрики, которые не восстановить из простых сумм: собираем взвешенно из
// per-SKU значений — реконструкция точна, потому что сами значения выведены
// сервером из этих же весов.
function weightedRules(skusMetrics: Map<string, BaseMetric>[], at: At): Record<string, () => number | null> {
  const collect = (valueField: string, weightField: string) => {
    let weightedSum = 0;
    let weightTotal = 0;
    for (const metrics of skusMetrics) {
      const value = metrics.has(valueField) ? at(metrics.get(valueField)!) : null;
      const weight = metrics.has(weightField) ? at(metrics.get(weightField)!) : null;
      if (value == null || weight == null || weight <= 0) continue;
      weightedSum += value * weight;
      weightTotal += weight;
    }
    return weightTotal > 0 ? weightedSum / weightTotal : null;
  };
  // Знаменатель маржи — выкупы ТОЛЬКО тех SKU, у которых прибыль посчитана.
  // Сервер считает именно так (costedBuyoutsSumDaily в buildTable). Общий
  // знаменатель по всем выбранным SKU занижал маржу тем сильнее, чем больше
  // товаров без себестоимости: половина ассортимента без закупочной цены
  // превращала честные 20% в 10%, и по этой цифре поднимали цены.
  const costedRatio = (profitField: string) => (): number | null => {
    let profit = 0;
    let buyouts = 0;
    let seen = false;
    for (const metrics of skusMetrics) {
      const gross = metrics.has(profitField) ? at(metrics.get(profitField)!) : null;
      const sum = metrics.has("buyouts_sum") ? at(metrics.get("buyouts_sum")!) : null;
      if (gross == null || sum == null) continue;
      profit += gross;
      buyouts += sum;
      seen = true;
    }
    return seen && buyouts > 0 ? r1((profit / buyouts) * 100) : null;
  };

  return {
    margin_pct: costedRatio("gross"),
    net_margin_pct: costedRatio("net_profit"),
    // Цена покупателя = Σ(цена_i × выкупы_gross_i) / Σвыкупов — точная сумма оплат.
    final_price: () => {
      const value = collect("final_price", "buyouts_gross_count");
      return value == null ? null : Math.round(value);
    },
    reviews_rating: () => {
      const value = collect("reviews_rating", "reviews_count");
      return value == null ? null : Math.round(value * 100) / 100;
    },
    reviews_bad_share_pct: () => {
      const value = collect("reviews_bad_share_pct", "reviews_count");
      return value == null ? null : r1(value);
    },
    // СПП: восстанавливаем сумму оплат покупателя из gross-выручки и ставки SKU.
    spp_pct: () => {
      let finished = 0;
      let gross = 0;
      for (const metrics of skusMetrics) {
        const grossRub = metrics.has("buyouts_gross_rub") ? at(metrics.get("buyouts_gross_rub")!) : null;
        const spp = metrics.has("spp_pct") ? at(metrics.get("spp_pct")!) : null;
        if (grossRub == null || grossRub <= 0 || spp == null) continue;
        finished += grossRub * (1 - spp / 100);
        gross += grossRub;
      }
      return gross > 0 ? r1((1 - finished / gross) * 100) : null;
    },
    // Скидка продавца: цена до скидки восстанавливается из суммы заказов и ставки.
    seller_discount_pct: () => {
      let ordersSum = 0;
      let grossRef = 0;
      for (const metrics of skusMetrics) {
        const sum = metrics.has("orders_sum") ? at(metrics.get("orders_sum")!) : null;
        const discount = metrics.has("seller_discount_pct") ? at(metrics.get("seller_discount_pct")!) : null;
        if (sum == null || sum <= 0 || discount == null || discount >= 100) continue;
        ordersSum += sum;
        grossRef += sum / (1 - discount / 100);
      }
      return grossRef > 0 ? r1((1 - ordersSum / grossRef) * 100) : null;
    },
  };
}

/**
 * Сводка по выбранным SKU. Шаблон — серверная сводка: подписи, источники и
 * статусы покрытия сохраняются, пересчитываются значения (daily/total) и
 * прогноз (суммой прогнозов SKU для суммируемых метрик; у производных
 * прогноз честно пуст). Оборачиваемость — как на сервере: остаток / средние
 * дневные выкупы за окно.
 */
export function composeRnpSummaryFromSkus<M extends BaseMetric>(
  template: M[],
  skus: { metrics: M[] }[],
  turnoverWindowDays: number,
): M[] {
  const skusMetrics = skus.map((sku) => new Map(sku.metrics.map((metric) => [metric.field, metric as BaseMetric])));
  const dayCount = template[0]?.daily.length ?? 0;

  const sumAt = (field: string, at: At): number | null => {
    let sum = 0;
    let seen = false;
    for (const metrics of skusMetrics) {
      const metric = metrics.get(field);
      if (!metric) continue;
      const value = at(metric);
      if (value == null || !Number.isFinite(value)) continue;
      sum += value;
      seen = true;
    }
    return seen ? sum : null;
  };

  const totalAt: At = (metric) => metric.total;
  const dailyAt = (index: number): At => (metric) => metric.daily[index] ?? null;
  const forecastAt: At = (metric) => metric.forecast;

  const weightedTotal = weightedRules(skusMetrics, totalAt);

  const turnoverTotal = (() => {
    const stock = sumAt("stock_total", totalAt) ?? sumAt("stock", totalAt);
    if (stock == null) return null;
    // Формула calculateTurnoverDays из buildTable: остаток / среднедневные
    // выкупы за последние N дней с данными.
    const buyoutsDaily = Array.from({ length: dayCount }, (_, index) => sumAt("buyouts_count", dailyAt(index)));
    const observed = buyoutsDaily.filter((value): value is number => value != null && Number.isFinite(value)).slice(-Math.max(1, turnoverWindowDays));
    if (!observed.length) return null;
    const average = observed.reduce((sum, value) => sum + value, 0) / observed.length;
    return average > 0 ? Math.round(stock / average) : null;
  })();

  const ratio = (num: number | null, den: number | null, scale: 100 | 1) => {
    if (num == null || den == null || !(den > 0)) return null;
    const value = (num / den) * scale;
    return scale === 100 ? r1(value) : Math.round(value);
  };
  // Сумма ряда частей по выбранным SKU. null в частях значит «факт неизвестен»
  // (кабинет без отчёта, день за отсечкой), а не ноль — поэтому день, где хоть
  // один SKU факта не знает, молчит целиком, как серверная сводка по кабинетам.
  // Иначе «все кабинеты» под фильтром показывали бы цифру одного из них.
  const sumParts = (field: string, pick: (parts: MetricParts) => (number | null)[], index: number) => {
    let sum = 0;
    let seen = false;
    for (const metrics of skusMetrics) {
      const parts = metrics.get(field)?.parts;
      if (!parts) continue;
      const value = pick(parts)[index];
      if (value == null || !Number.isFinite(value)) return null;
      sum += value;
      seen = true;
    }
    return seen ? sum : null;
  };
  const knownTotal = (values: (number | null)[]) => {
    const known = values.filter((value): value is number => value != null && Number.isFinite(value));
    return known.length ? known.reduce((acc, value) => acc + value, 0) : null;
  };

  return template.map((metric) => {
    const scale = metric.parts?.scale
      ?? skusMetrics.map((metrics) => metrics.get(metric.field)?.parts?.scale).find((value) => value != null);
    if (scale != null) {
      const rawNumerator = Array.from({ length: dayCount }, (_, index) => sumParts(metric.field, (parts) => parts.numerator, index));
      const rawDenominator = Array.from({ length: dayCount }, (_, index) => sumParts(metric.field, (parts) => parts.denominator, index));
      const numerator = rawNumerator.map((value, index) => rawDenominator[index] == null ? null : value);
      const denominator = rawDenominator.map((value, index) => rawNumerator[index] == null ? null : value);
      return {
        ...metric,
        daily: numerator.map((num, index) => ratio(num, denominator[index], scale)),
        total: ratio(knownTotal(numerator), knownTotal(denominator), scale),
        forecast: null,
        parts: { numerator, denominator, scale },
      };
    }
    // Снимок, собранный до появления `parts`: долю из процентов SKU не сложить,
    // а общее правило ниже просуммировало бы их (три SKU по 90% дали бы 270%).
    if (PARTS_ONLY_FIELDS.has(metric.field)) {
      return { ...metric, daily: Array.from({ length: dayCount }, () => null), total: null, forecast: null };
    }
    const rule = RATIO_RULES[metric.field];
    if (rule) {
      return {
        ...metric,
        daily: Array.from({ length: dayCount }, (_, index) => rule((field) => sumAt(field, dailyAt(index)))),
        total: rule((field) => sumAt(field, totalAt)),
        forecast: null,
      };
    }
    const weighted = weightedTotal[metric.field as keyof ReturnType<typeof weightedRules>];
    if (weighted) {
      return {
        ...metric,
        daily: Array.from({ length: dayCount }, (_, index) => {
          const rules = weightedRules(skusMetrics, dailyAt(index));
          return rules[metric.field as keyof typeof rules]?.() ?? null;
        }),
        total: weighted(),
        forecast: null,
      };
    }
    if (metric.field === "turnover" || metric.field === "gmroi") {
      const total = metric.field === "turnover"
        ? turnoverTotal
        : RATIO_RULES.gmroi((field) => sumAt(field, totalAt));
      return {
        ...metric,
        // Точечные метрики (снимок на дату): значение живёт там же, где у шаблона.
        daily: metric.daily.map((value) => (value == null ? null : total)),
        total,
        forecast: null,
      };
    }
    return {
      ...metric,
      daily: Array.from({ length: dayCount }, (_, index) => sumAt(metric.field, dailyAt(index))),
      total: (() => {
        const value = sumAt(metric.field, totalAt);
        return value == null ? null : Math.round(value);
      })(),
      forecast: (() => {
        const value = sumAt(metric.field, forecastAt);
        return value == null ? null : Math.round(value);
      })(),
    };
  });
}
