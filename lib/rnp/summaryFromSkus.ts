import { aggregateRnpWeekly } from "./operatingMatrix";

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
  /**
   * Части прибыльных долей строки сводки (только SKU с себестоимостью) — для
   * недельных колонок. Шаблонные weeklyParts посчитаны по ВСЕМ SKU и под фильтром
   * неверны: пересборка отдаёт свои, по выбранным.
   */
  weeklyParts?: MetricParts;
}

/** Прибыльные доли: числитель есть только у SKU с себестоимостью (см. costedRatio). */
const COSTED_RATIOS: Record<string, { profit: string; denominator: string; scale: 100 | 1 }> = {
  margin_pct: { profit: "gross", denominator: "buyouts_sum", scale: 100 },
  net_margin_pct: { profit: "net_profit", denominator: "buyouts_sum", scale: 100 },
  profit_per_unit: { profit: "gross", denominator: "buyouts_count", scale: 1 },
  romi: { profit: "gross", denominator: "ad_spent", scale: 100 },
};

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

/**
 * Доли, чьи части — суммы строк самой таблицы. Под фильтром их пересчитываем из
 * строк (sumAt пропускает SKU без факта), а не из `parts`: sumParts гасит день
 * целиком, если у одного SKU части нет, и кабинет без синка продаж обнулял бы
 * цену выкупа у всего фильтра, хотя сервер его просто не учитывает.
 */
const RECOMPUTED_FROM_ROWS = new Set(["avg_buyout_price"]);

/**
 * Разбивка заказов по схемам: у артикула она молчит в дни без воронки и после
 * границы синка сборочных заданий его кабинета. Сумма «по тем, кто знает» дала
 * бы под фильтром FBS/FBW одного кабинета при заказах двух, а сводка без
 * фильтра за этот день честно молчит. Поэтому день пуст, если хоть у одного
 * выбранного артикула заказы известны, а схема — нет.
 */
const STRICT_SCHEME_FIELDS = new Set(["orders_fbs_count", "orders_fbs_sum", "orders_fbw_count", "orders_fbw_sum"]);

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
  // только из своих `parts` (когорта заказов, логистика финотчёта) — см. ниже.
  fbs_share_pct: (g) => {
    const fbs = g("orders_fbs_sum");
    const known = (fbs ?? 0) + (g("orders_fbw_sum") ?? 0);
    return fbs != null && known > 0 ? r1((fbs / known) * 100) : null;
  },
  drr: (g) => pctOf(g("ad_spent"), g("orders_sum")),
  // romi/profit_per_unit — В weightedRules, не здесь: g("gross") суммирует
  // только SKU с известной себестоимостью (она null у остальных), а
  // g("ad_spent")/g("buyouts_count") суммировали бы ВСЕ выбранные SKU — тот же
  // баг, что чинили для margin_pct (costedRatio ниже), просто для другой пары
  // полей. SKU A gross=100000₽/buyouts=50 (себестоимость известна) + SKU B
  // gross=null/buyouts=200 (неизвестна) давало бы profit_per_unit=400₽/шт
  // вместо верных 100000/50=2000₽/шт.
  avg_order_price: (g) => perUnit(g("orders_sum"), g("orders_count")),
  // «Выкуплено, ₽» = выкупы нетто + возвраты; то же, что parts у buildTable.
  avg_buyout_price: (g) => {
    const sum = g("buyouts_sum");
    const returns = g("returns_sum");
    return sum == null || returns == null ? null : perUnit(sum + returns, g("buyouts_gross_count"));
  },
};

/**
 * Поля, из которых собрана каждая доля RATIO_RULES. Итог периода складывает их
 * только за дни, где известны ВСЕ: источники кончаются в разные дни, и итог из
 * сумм «за все дни» делил бы заказы за 8 дней на переходы за 7.
 */
const RATIO_FIELDS: Record<string, string[]> = {
  ctr: ["clicks", "views"],
  cart_cr: ["cart", "open_card"],
  order_cr: ["orders_count", "open_card"],
  org_cr_pct: ["org_orders_count", "org_open_card"],
  org_share_pct: ["org_open_card", "open_card"],
  buyout_pct: ["buyouts_count", "orders_count"],
  cancel_pct: ["cancels_count", "orders_count"],
  return_pct: ["returns_count", "buyouts_gross_count"],
  fbs_share_pct: ["orders_fbs_sum", "orders_fbw_sum"],
  drr: ["ad_spent", "orders_sum"],
  avg_order_price: ["orders_sum", "orders_count"],
  avg_buyout_price: ["buyouts_sum", "returns_sum", "buyouts_gross_count"],
};

/**
 * «Прибыль к запасу» (поле gmroi): прибыль за период / деньги в остатках. Точка в
 * дате факта, как на сервере. Раньше правило стояло в RATIO_RULES и срабатывало
 * раньше точечной ветки: под фильтром метрика заполнялась во все дни.
 */
function gmroiFrom(g: Get): number | null {
  const value = pctOf(g("gross"), g("money"));
  return value == null ? null : Math.min(999, value);
}

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
  // Знаменатель — сумма поля denominatorField ТОЛЬКО тех SKU, у которых
  // числитель (profitField) посчитан. Сервер считает именно так
  // (costedBuyoutsSumDaily/costedBuyoutsCountDaily/costedAdSpendDaily в
  // buildTable). Знаменатель по ВСЕМ выбранным SKU занижал бы метрику тем
  // сильнее, чем больше товаров без себестоимости: половина ассортимента без
  // закупочной цены превращала честные 20% маржи в 10%, и по этой цифре
  // поднимали цены (тот же класс бага для profit_per_unit/romi — см. коммент
  // у RATIO_RULES выше).
  const costedRatio = (profitField: string, denominatorField: string, scale: 100 | 1) => (): number | null => {
    let profit = 0;
    let denominator = 0;
    let seen = false;
    for (const metrics of skusMetrics) {
      const value = metrics.has(profitField) ? at(metrics.get(profitField)!) : null;
      const den = metrics.has(denominatorField) ? at(metrics.get(denominatorField)!) : null;
      if (value == null || den == null) continue;
      profit += value;
      denominator += den;
      seen = true;
    }
    if (!seen || denominator <= 0) return null;
    const result = (profit / denominator) * scale;
    return scale === 100 ? r1(result) : Math.round(result);
  };

  return {
    margin_pct: costedRatio(COSTED_RATIOS.margin_pct.profit, COSTED_RATIOS.margin_pct.denominator, COSTED_RATIOS.margin_pct.scale),
    net_margin_pct: costedRatio(COSTED_RATIOS.net_margin_pct.profit, COSTED_RATIOS.net_margin_pct.denominator, COSTED_RATIOS.net_margin_pct.scale),
    profit_per_unit: costedRatio(COSTED_RATIOS.profit_per_unit.profit, COSTED_RATIOS.profit_per_unit.denominator, COSTED_RATIOS.profit_per_unit.scale),
    romi: costedRatio(COSTED_RATIOS.romi.profit, COSTED_RATIOS.romi.denominator, COSTED_RATIOS.romi.scale),
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
  const strictSchemeAt = (field: string, index: number): number | null => {
    let sum = 0;
    let seen = false;
    for (const metrics of skusMetrics) {
      const value = metrics.get(field)?.daily[index];
      if (value == null || !Number.isFinite(value)) {
        if (metrics.get("orders_count")?.daily[index] != null) return null;
        continue;
      }
      sum += value;
      seen = true;
    }
    return seen ? sum : null;
  };
  // Значение поля за день для пересчёта: схема — строго, остальное — по тем, кто знает.
  const dayValue = (field: string, index: number) => STRICT_SCHEME_FIELDS.has(field)
    ? strictSchemeAt(field, index)
    : sumAt(field, dailyAt(index));
  const dailyAt = (index: number): At => (metric) => metric.daily[index] ?? null;
  const forecastAt: At = (metric) => metric.forecast;

  const weightedTotal = weightedRules(skusMetrics, totalAt);

  // Формула calculateTurnoverDays из buildTable: остаток / среднедневные выкупы за
  // последние N дней с данными. Остаток — именно «Остаток», как на сервере. Раньше
  // брался stock_total (остаток + товар в пути к клиенту и обратно), и под любым
  // фильтром оборачиваемость выходила в ~1,8 раза больше серверной.
  const averageDailyBuyouts = (() => {
    const buyoutsDaily = Array.from({ length: dayCount }, (_, index) => sumAt("buyouts_count", dailyAt(index)));
    const observed = buyoutsDaily.filter((value): value is number => value != null && Number.isFinite(value)).slice(-Math.max(1, turnoverWindowDays));
    if (!observed.length) return null;
    return observed.reduce((sum, value) => sum + value, 0) / observed.length;
  })();
  const turnoverFor = (stock: number | null) =>
    stock != null && averageDailyBuyouts != null && averageDailyBuyouts > 0 ? Math.round(stock / averageDailyBuyouts) : null;
  const turnoverTotal = turnoverFor(sumAt("stock", totalAt));

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

  // Части прибыльной доли по дням — только SKU, у которых известны и прибыль, и
  // знаменатель в этот день (тот же отбор, что у costedRatio и у сервера).
  const costedParts = (profitField: string, denominatorField: string, scale: 100 | 1): MetricParts => {
    const numerator: (number | null)[] = [];
    const denominator: (number | null)[] = [];
    for (let index = 0; index < dayCount; index++) {
      let num = 0, den = 0, seen = false;
      for (const metrics of skusMetrics) {
        const profit = metrics.get(profitField)?.daily[index];
        const base = metrics.get(denominatorField)?.daily[index];
        if (profit == null || base == null || !Number.isFinite(profit) || !Number.isFinite(base)) continue;
        num += profit;
        den += base;
        seen = true;
      }
      numerator.push(seen ? num : null);
      denominator.push(seen ? den : null);
    }
    return { numerator, denominator, scale };
  };

  // Части цены выкупа из строк выбранных SKU: «Выкуплено, ₽» и «Выкуплено, шт».
  const buyoutPriceParts = (): MetricParts => {
    const numerator: (number | null)[] = [];
    const denominator: (number | null)[] = [];
    for (let index = 0; index < dayCount; index++) {
      const sum = sumAt("buyouts_sum", dailyAt(index));
      const returns = sumAt("returns_sum", dailyAt(index));
      const count = sumAt("buyouts_gross_count", dailyAt(index));
      const known = sum != null && returns != null && count != null;
      numerator.push(known ? sum + returns : null);
      denominator.push(known ? count : null);
    }
    return { numerator, denominator, scale: 1 };
  };

  return template.map((templateMetric) => {
    // weeklyParts шаблона посчитаны по всему набору SKU — под фильтром они чужие.
    const { weeklyParts: _templateWeeklyParts, ...rest } = templateMetric;
    void _templateWeeklyParts;
    const metric = rest as M;
    const scale = metric.parts?.scale
      ?? skusMetrics.map((metrics) => metrics.get(metric.field)?.parts?.scale).find((value) => value != null);
    if (scale != null && !RECOMPUTED_FROM_ROWS.has(metric.field)) {
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
      const fields = RATIO_FIELDS[metric.field] ?? [];
      // Дни, где известны все поля доли: итог — только из них.
      const matchedIndexes = Array.from({ length: dayCount }, (_, index) => index)
        .filter((index) => fields.every((field) => dayValue(field, index) != null));
      const matchedTotal = (field: string) => {
        let sum = 0;
        let seen = false;
        for (const index of matchedIndexes) {
          const value = dayValue(field, index);
          if (value == null) continue;
          sum += value;
          seen = true;
        }
        return seen ? sum : null;
      };
      return {
        ...metric,
        daily: Array.from({ length: dayCount }, (_, index) => rule((field) => dayValue(field, index))),
        total: fields.length ? rule(matchedTotal) : rule((field) => sumAt(field, totalAt)),
        forecast: null,
        // Части шаблона посчитаны по всем SKU — неделя под фильтром взяла бы их.
        ...(RECOMPUTED_FROM_ROWS.has(metric.field) ? { parts: buyoutPriceParts() } : {}),
      };
    }
    const weighted = weightedTotal[metric.field as keyof ReturnType<typeof weightedRules>];
    if (weighted) {
      const costed = COSTED_RATIOS[metric.field];
      return {
        ...metric,
        daily: Array.from({ length: dayCount }, (_, index) => {
          const rules = weightedRules(skusMetrics, dailyAt(index));
          return rules[metric.field as keyof typeof rules]?.() ?? null;
        }),
        total: weighted(),
        forecast: null,
        // Недельные колонки пересчитают прибыльную долю из этих частей, а не
        // средним по дням (margin_pct в WEEKLY_RATIO_PAIRS нет намеренно).
        ...(costed ? { weeklyParts: costedParts(costed.profit, costed.denominator, costed.scale) } : {}),
      };
    }
    if (metric.field === "turnover") {
      return {
        ...metric,
        // Ряд по дням: остаток дня выбранных SKU / те же среднедневные выкупы, что
        // у сервера. Раньше каждый день затирался одним итогом.
        daily: Array.from({ length: dayCount }, (_, index) =>
          metric.daily[index] == null ? null : turnoverFor(sumAt("stock", dailyAt(index)))),
        total: turnoverTotal,
        forecast: null,
      };
    }
    if (metric.field === "gmroi") {
      const total = gmroiFrom((field) => sumAt(field, totalAt));
      return {
        ...metric,
        // Точечная метрика (снимок на дату): значение живёт там же, где у шаблона.
        daily: metric.daily.map((value) => (value == null ? null : total)),
        total,
        forecast: null,
      };
    }
    if (STRICT_SCHEME_FIELDS.has(metric.field)) {
      const daily = Array.from({ length: dayCount }, (_, index) => strictSchemeAt(metric.field, index));
      const total = knownTotal(daily);
      return { ...metric, daily, total: total == null ? null : Math.round(total), forecast: null };
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

/**
 * Сводка по выбранным SKU для недельного вида — из ДНЕВНЫХ SKU, свёрнутая в недели.
 *
 * Собирать её из недельных SKU нельзя: части долей там уже сложены по неделям,
 * каждая за свои дни, и итог под фильтром начинал зависеть от гранулярности
 * (заказы за неделю делились на переходы без сегодняшнего дня), а
 * «среднедневные» выкупы оборачиваемости становились средненедельными — дни
 * превращались в недели. Итоги берутся из дневной сборки, недельные колонки —
 * из её частей тем же aggregateRnpWeekly, что и у несфильтрованной сводки.
 */
export function composeRnpWeeklySummaryFromDailySkus<M extends BaseMetric>(
  daily: { period: { label: string; period_type: string }[]; summary: M[]; skus: { nm: number; metrics: M[] }[] },
  visibleNms: ReadonlySet<number>,
  turnoverWindowDays: number,
  fromIso: string,
  todayIso?: string,
): M[] {
  const composed = composeRnpSummaryFromSkus(
    daily.summary,
    daily.skus.filter((sku) => visibleNms.has(sku.nm)),
    turnoverWindowDays,
  );
  return aggregateRnpWeekly({ period: daily.period, summary: composed, skus: [] }, fromIso, todayIso).summary;
}
