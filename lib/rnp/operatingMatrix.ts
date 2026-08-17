export const RNP_METRIC_FIELDS = [
  "views",
  "clicks",
  "ctr",
  "ad_orders",
  "ad_orders_sum",
  "open_card",
  "cart",
  "wishlist",
  "cart_cr",
  "order_cr",
  "org_open_card",
  "org_orders_count",
  "org_cr_pct",
  "org_share_pct",
  "orders_sum",
  "orders_count",
  "orders_fbs_count",
  "orders_fbs_sum",
  "orders_fbw_count",
  "orders_fbw_sum",
  "fbs_share_pct",
  "cancels_count",
  "cancel_pct",
  "buyouts_sum",
  "buyouts_count",
  "buyouts_gross_count",
  "buyouts_gross_rub",
  "returns_count",
  "returns_sum",
  "return_pct",
  "buyout_pct",
  "actual_buyout_pct",
  "orders_spp_sum",
  "avg_order_price",
  "seller_discount_pct",
  "avg_buyout_price",
  "final_price",
  "spp_pct",
  "gross",
  "margin_pct",
  "agent_commission_rub",
  "tax_rub",
  "net_profit",
  "net_margin_pct",
  "cogs",
  "commission_rub",
  "acquiring_rub",
  "logistics_rub",
  "delivery_rub",
  "storage_rub",
  "penalty_rub",
  "acceptance_rub",
  "deduction_rub",
  "mp_cost_rub",
  "profit_per_unit",
  "romi",
  "ad_spent",
  "drr",
  "stock",
  "stock_in_way_to_client",
  "stock_in_way_from_client",
  "stock_total",
  "turnover",
  "money",
  "gmroi",
  "reviews_count",
  "reviews_rating",
  "reviews_bad_share_pct",
  "ads_manual_spent",
  "ads_manual_views",
  "ads_manual_clicks",
  "ads_manual_orders",
  "ads_manual_orders_sum",
  "ads_unified_spent",
  "ads_unified_views",
  "ads_unified_clicks",
  "ads_unified_orders",
  "ads_unified_orders_sum",
] as const;

export type RnpMetricField = (typeof RNP_METRIC_FIELDS)[number];
export type RnpViewId = "main" | "sales" | "price" | "conversion" | "ads" | "stock" | "economy" | "custom";
export type RnpDeltaMode = "percent" | "absolute";
export type RnpAnomalyDirection = "all" | "negative" | "positive";

export interface RnpOperatingMetric {
  field: string;
  kind: string;
  total: number | null;
  daily?: Array<number | null>;
}

export interface RnpOperatingSku {
  nm: number;
  art: string;
  name: string;
  metrics: RnpOperatingMetric[];
}

export interface RnpMetricDelta {
  absolute: number;
  percent: number | null;
  direction: "up" | "down" | "flat";
}

export type RnpAnomalyKind = "delta" | "coverage" | "streak";

export interface RnpAnomaly {
  field: string;
  label: string;
  direction: "positive" | "negative";
  /** Отклонение к прошлому периоду. Для сигналов покрытия/серии — null. */
  delta: RnpMetricDelta | null;
  kind: RnpAnomalyKind;
  /** Тип метрики ("pct" — отклонение измеряется в пунктах, иначе в процентах). */
  metricKind?: string;
  /** Дней покрытия (kind=coverage) или длина серии в днях (kind=streak). */
  days?: number;
}

/**
 * Пороги детектора по каждой метрике (как в отраслевых кокпитах): для абсолютных
 * метрик — в процентах, для процентных — в пунктах. Значения ниже порога не
 * попадают в список, поэтому больше порог — меньше артикулов.
 */
export interface RnpAnomalyThresholds {
  /** Порог отклонения по метрике: % для абсолютных, п.п. для процентных. */
  byField: Partial<Record<RnpMetricField, number>>;
  /** Сигнал, если остатка хватает меньше чем на столько дней. */
  stockCoverageDays: number;
  /** Сигнал, если метрика падает столько дней подряд. */
  streakDays: number;
}

/** Метрики, отклонение которых меряется в пунктах, а не в процентах. */
const POINT_THRESHOLD_FIELDS = new Set<string>(["buyout_pct", "drr", "ctr", "margin_pct", "cart_cr", "order_cr", "cancel_pct", "return_pct", "seller_discount_pct", "spp_pct", "net_margin_pct", "fbs_share_pct"]);

export const DEFAULT_RNP_ANOMALY_THRESHOLDS: RnpAnomalyThresholds = {
  byField: {
    views: 30,
    clicks: 30,
    open_card: 30,
    cart: 30,
    cart_cr: 2,
    order_cr: 2,
    orders_count: 30,
    orders_sum: 30,
    cancels_count: 30,
    buyouts_count: 30,
    buyouts_sum: 30,
    returns_count: 30,
    returns_sum: 30,
    turnover: 30,
    buyout_pct: 5,
    // Отмены и возвраты живут в единицах процента, а не десятках: порог как у CTR,
    // иначе реальный рост доли возвратов с 2% до 5% детектор бы не заметил.
    cancel_pct: 2,
    orders_fbs_count: 30,
    orders_fbs_sum: 30,
    orders_fbw_count: 30,
    orders_fbw_sum: 30,
    // Сдвиг доли схем на 5 п.п. — это уже смена модели торговли, а не шум.
    fbs_share_pct: 5,
    return_pct: 2,
    actual_buyout_pct: 5,
    buyouts_gross_count: 30,
    buyouts_gross_rub: 30,
    orders_spp_sum: 30,
    // Цены двигаются мельче потоков: 10% по чеку — это уже смена ценовой политики,
    // а 3 п.п. по скидке/СПП — заметный сдвиг для покупателя.
    avg_order_price: 10,
    avg_buyout_price: 10,
    final_price: 10,
    seller_discount_pct: 3,
    spp_pct: 3,
    stock_in_way_to_client: 30,
    stock_in_way_from_client: 30,
    stock_total: 30,
    cogs: 30,
    commission_rub: 30,
    acquiring_rub: 30,
    logistics_rub: 30,
    delivery_rub: 30,
    storage_rub: 30,
    penalty_rub: 30,
    acceptance_rub: 30,
    deduction_rub: 30,
    mp_cost_rub: 30,
    profit_per_unit: 20,
    romi: 30,
    net_profit: 30,
    net_margin_pct: 5,
    drr: 5,
    ctr: 2,
    margin_pct: 5,
  },
  stockCoverageDays: 7,
  streakDays: 3,
};

export const RNP_VIEW_PRESETS: ReadonlyArray<{
  id: Exclude<RnpViewId, "custom">;
  label: string;
  description: string;
  fields: RnpMetricField[];
}> = [
  {
    id: "main",
    label: "Основное",
    description: "Заказы, выкупы, прибыль и реклама",
    fields: ["orders_sum", "orders_count", "buyouts_sum", "buyouts_count", "buyout_pct", "gross", "margin_pct", "ad_spent", "drr"],
  },
  {
    id: "sales",
    label: "Продажи и возвраты",
    description: "Заказы, отмены, выкупы и возвраты",
    fields: ["orders_sum", "orders_spp_sum", "orders_count", "orders_fbs_count", "orders_fbs_sum", "orders_fbw_count", "orders_fbw_sum", "fbs_share_pct", "cancels_count", "cancel_pct", "buyouts_gross_count", "buyouts_gross_rub", "buyouts_sum", "buyouts_count", "returns_count", "returns_sum", "return_pct", "buyout_pct", "actual_buyout_pct"],
  },
  {
    id: "price",
    label: "Цены",
    description: "Чек, скидка продавца и СПП",
    fields: ["orders_count", "avg_order_price", "seller_discount_pct", "avg_buyout_price", "final_price", "spp_pct"],
  },
  {
    id: "conversion",
    label: "Конверсии",
    description: "Показы, переходы, корзины и выкуп",
    fields: ["views", "clicks", "ctr", "open_card", "cart", "cart_cr", "order_cr", "org_open_card", "org_orders_count", "org_cr_pct", "org_share_pct", "orders_count", "buyout_pct"],
  },
  {
    id: "ads",
    label: "Реклама",
    description: "Трафик, расходы и эффективность",
    fields: ["views", "clicks", "ctr", "ad_orders", "ad_orders_sum", "open_card", "orders_sum", "orders_count", "ad_spent", "drr"],
  },
  {
    id: "stock",
    label: "Остатки",
    description: "Остаток, товар в пути, оборачиваемость и деньги на складе",
    fields: ["orders_count", "buyouts_count", "stock", "stock_in_way_to_client", "stock_in_way_from_client", "stock_total", "turnover", "money"],
  },
  {
    id: "economy",
    label: "Юнит-экономика",
    description: "Выручка, расходы по статьям, прибыль и отдача",
    fields: ["buyouts_sum", "cogs", "commission_rub", "acquiring_rub", "logistics_rub", "mp_cost_rub", "ad_spent", "gross", "tax_rub", "net_profit", "net_margin_pct", "profit_per_unit", "romi", "gmroi"],
  },
];

const POSITIVE_WHEN_UP = new Set([
  "views",
  "clicks",
  "ctr",
  "ad_orders",
  "ad_orders_sum",
  "open_card",
  "cart",
  "wishlist",
  "cart_cr",
  "order_cr",
  "org_open_card",
  "org_orders_count",
  "org_cr_pct",
  "org_share_pct",
  "orders_sum",
  "orders_count",
  "buyouts_sum",
  "buyouts_count",
  "buyout_pct",
  "actual_buyout_pct",
  "buyouts_gross_count",
  "buyouts_gross_rub",
  "orders_spp_sum",
  "gross",
  "margin_pct",
  "stock",
  "gmroi",
  "avg_order_price",
  "avg_buyout_price",
  "final_price",
  "profit_per_unit",
  "romi",
  // Товар в пути к клиенту — это уже проданное: рост означает продажи, а не залёж.
  "stock_in_way_to_client",
  // СПП — скидка WB, а не продавца: растёт СПП → покупателю дешевле при той же
  // выручке продавца. Для кабинета это хорошая новость.
  "spp_pct",
  "reviews_rating",
]);
// Рост отмен, возвратов и собственной скидки — плохая новость, направление обратное.
const POSITIVE_WHEN_DOWN = new Set([
  "reviews_bad_share_pct",
  "drr",
  "turnover",
  "cancels_count",
  "cancel_pct",
  "returns_count",
  "returns_sum",
  "return_pct",
  "seller_discount_pct",
  // Обратный поток со склада — это возвраты в дороге, ранний сигнал проблемы.
  "stock_in_way_from_client",
]);

const METRIC_LABELS: Record<string, string> = {
  views: "Показы",
  clicks: "Клики",
  ctr: "CTR",
  ad_orders: "Заказы РК",
  wishlist: "Избранное",
  ad_orders_sum: "Заказы РК ₽",
  org_open_card: "Переходы орг",
  org_orders_count: "Заказы орг",
  org_cr_pct: "CR орг",
  org_share_pct: "Орг %",
  open_card: "Переходы",
  cart: "Корзины",
  cart_cr: "Конверсия в корзину",
  order_cr: "Конверсия в заказ",
  orders_sum: "Заказы, ₽",
  orders_count: "Заказы, шт",
  orders_fbs_count: "Заказы FBS, шт",
  orders_fbs_sum: "Заказы FBS, ₽",
  orders_fbw_count: "Заказы FBW, шт",
  orders_fbw_sum: "Заказы FBW, ₽",
  fbs_share_pct: "Доля FBS",
  cancels_count: "Отмены, шт",
  cancel_pct: "Доля отмен",
  buyouts_sum: "Выкупы, ₽",
  buyouts_count: "Выкупы, шт",
  returns_count: "Возвраты, шт",
  returns_sum: "Возвраты, ₽",
  return_pct: "Доля возвратов",
  buyout_pct: "Выкуп",
  actual_buyout_pct: "Фактический выкуп",
  buyouts_gross_count: "Выкуплено, шт",
  buyouts_gross_rub: "Выкуплено, ₽",
  orders_spp_sum: "Заказы с СПП",
  avg_order_price: "Средняя цена заказа",
  seller_discount_pct: "Скидка продавца",
  avg_buyout_price: "Средняя цена выкупа",
  final_price: "Цена для покупателя",
  spp_pct: "СПП",
  gross: "Прибыль",
  margin_pct: "Маржа",
  agent_commission_rub: "Комиссия каб.",
  tax_rub: "Налог",
  net_profit: "Чистая прибыль",
  net_margin_pct: "Чистая маржа",
  cogs: "Себестоимость проданного",
  commission_rub: "Комиссия WB",
  acquiring_rub: "Эквайринг",
  logistics_rub: "Логистика и удержания",
  delivery_rub: "Логистика",
  storage_rub: "Хранение",
  penalty_rub: "Штрафы",
  acceptance_rub: "Приёмка",
  deduction_rub: "Прочие удержания",
  mp_cost_rub: "Расходы МП",
  profit_per_unit: "Прибыль на единицу",
  romi: "ROMI",
  ad_spent: "Реклама",
  drr: "ДРР",
  stock: "Остаток",
  stock_in_way_to_client: "В пути к клиенту",
  stock_in_way_from_client: "В пути от клиента",
  stock_total: "Всего на складах",
  turnover: "Оборачиваемость",
  money: "Деньги в остатках",
  gmroi: "GMROI",
  reviews_count: "Отзывы",
  ads_manual_spent: "Ручн. ₽",
  ads_manual_views: "Ручн. показы",
  ads_manual_clicks: "Ручн. клики",
  ads_manual_orders: "Ручн. заказы",
  ads_manual_orders_sum: "Ручн. заказы ₽",
  ads_unified_spent: "Един. ₽",
  ads_unified_views: "Един. показы",
  ads_unified_clicks: "Един. клики",
  ads_unified_orders: "Един. заказы",
  ads_unified_orders_sum: "Един. заказы ₽",
  reviews_rating: "Рейтинг нов.",
  reviews_bad_share_pct: "1–3★ %",
};

/**
 * Короткие подписи для бейджей аномалий (в строку на карточке артикула).
 * Регистр задан явно: аббревиатуры остаются заглавными.
 */
const METRIC_BADGE_LABELS: Record<string, string> = {
  views: "показы",
  clicks: "клики",
  ctr: "CTR",
  ad_orders: "Заказы РК",
  wishlist: "Избранное",
  ad_orders_sum: "Заказы РК ₽",
  org_open_card: "Переходы орг",
  org_orders_count: "Заказы орг",
  org_cr_pct: "CR орг",
  org_share_pct: "Орг %",
  open_card: "переходы",
  cart: "корзины",
  cart_cr: "конв. в корзину",
  order_cr: "конв. в заказ",
  orders_sum: "заказы ₽",
  orders_count: "заказы",
  orders_fbs_count: "заказы FBS",
  orders_fbs_sum: "заказы FBS ₽",
  orders_fbw_count: "заказы FBW",
  orders_fbw_sum: "заказы FBW ₽",
  fbs_share_pct: "доля FBS",
  cancels_count: "отмены",
  cancel_pct: "доля отмен",
  buyouts_sum: "выкупы ₽",
  buyouts_count: "выкупы",
  returns_count: "возвраты",
  returns_sum: "возвраты ₽",
  return_pct: "доля возвратов",
  buyout_pct: "выкуп",
  actual_buyout_pct: "факт. выкуп",
  buyouts_gross_count: "выкуплено",
  buyouts_gross_rub: "выкуплено ₽",
  orders_spp_sum: "заказы с СПП",
  avg_order_price: "цена заказа",
  seller_discount_pct: "скидка продавца",
  avg_buyout_price: "цена выкупа",
  final_price: "цена покупателя",
  spp_pct: "СПП",
  gross: "прибыль",
  margin_pct: "маржа",
  tax_rub: "налог",
  net_profit: "чистая прибыль",
  net_margin_pct: "чистая маржа",
  cogs: "себестоимость",
  commission_rub: "комиссия",
  acquiring_rub: "эквайринг",
  logistics_rub: "логистика и удержания",
  delivery_rub: "логистика",
  storage_rub: "хранение",
  penalty_rub: "штрафы",
  acceptance_rub: "приёмка",
  deduction_rub: "прочие удержания",
  mp_cost_rub: "расходы МП",
  profit_per_unit: "прибыль на единицу",
  romi: "ROMI",
  ad_spent: "реклама",
  drr: "ДРР",
  stock: "остаток",
  stock_in_way_to_client: "в пути к клиенту",
  stock_in_way_from_client: "в пути от клиента",
  stock_total: "всего на складах",
  turnover: "оборач.",
  money: "деньги в остатках",
  gmroi: "GMROI",
  reviews_count: "Отзывы",
  ads_manual_spent: "Ручн. ₽",
  ads_manual_views: "Ручн. показы",
  ads_manual_clicks: "Ручн. клики",
  ads_manual_orders: "Ручн. заказы",
  ads_manual_orders_sum: "Ручн. заказы ₽",
  ads_unified_spent: "Един. ₽",
  ads_unified_views: "Един. показы",
  ads_unified_clicks: "Един. клики",
  ads_unified_orders: "Един. заказы",
  ads_unified_orders_sum: "Един. заказы ₽",
  reviews_rating: "Рейтинг нов.",
  reviews_bad_share_pct: "1–3★ %",
};

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function previousEqualRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const previousEnd = new Date(start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);
  return { from: isoDate(previousStart), to: isoDate(previousEnd) };
}

export function sanitizeMetricFields(value: unknown, fallback: readonly string[] = RNP_VIEW_PRESETS[0].fields): RnpMetricField[] {
  if (!Array.isArray(value)) return [...fallback] as RnpMetricField[];
  const allowed = new Set<string>(RNP_METRIC_FIELDS);
  const seen = new Set<string>();
  const result = value
    .filter((field): field is string => {
      if (typeof field !== "string" || !allowed.has(field) || seen.has(field)) return false;
      seen.add(field);
      return true;
    })
    .map((field) => {
      return field as RnpMetricField;
    });
  return result.length ? result : [...fallback] as RnpMetricField[];
}

export function parseArticleList(value: string) {
  return [...new Set(
    value
      .normalize("NFKC")
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLocaleLowerCase("ru-RU"))
      .filter(Boolean),
  )].slice(0, 500);
}

export function matchesArticleList(sku: Pick<RnpOperatingSku, "nm" | "art" | "name">, query: string) {
  const tokens = parseArticleList(query);
  if (!tokens.length) return true;
  const art = sku.art.normalize("NFKC").toLocaleLowerCase("ru-RU");
  const name = sku.name.normalize("NFKC").toLocaleLowerCase("ru-RU");
  const nm = String(sku.nm);
  return tokens.some((token) => art.includes(token) || name.includes(token) || nm.includes(token));
}

export function metricDelta(current: number | null | undefined, previous: number | null | undefined): RnpMetricDelta | null {
  if (!finite(current) || !finite(previous)) return null;
  const absolute = Math.round((current - previous) * 10) / 10;
  const percent = previous === 0 ? null : Math.round((absolute / Math.abs(previous)) * 1_000) / 10;
  return {
    absolute,
    percent,
    direction: absolute > 0 ? "up" : absolute < 0 ? "down" : "flat",
  };
}

export function dayOverDayBaseline(
  currentDaily: Array<number | null | undefined>,
  previousPeriodDaily: Array<number | null | undefined> | undefined,
  index: number,
) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= currentDaily.length) return null;
  if (index > 0) return currentDaily[index - 1] ?? null;
  return previousPeriodDaily?.at(-1) ?? null;
}

export function isOpenMoscowDayLabel(label: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(now);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return Boolean(day && month && label === `${day}.${month}`);
}

/**
 * Метрики, у которых рост сам по себе ничего не значит: расходы в рублях растут
 * вместе с продажами. Сигналом служат их доли (ДРР, маржа), а не абсолютные суммы.
 */
const VOLUME_SCALED_FIELDS = new Set([
  "ad_spent",
  "money",
  "cogs",
  "commission_rub",
  "acquiring_rub",
  "logistics_rub",
  "delivery_rub",
  "storage_rub",
  "penalty_rub",
  "acceptance_rub",
  "deduction_rub",
  "mp_cost_rub",
  // Налог считается от выручки — растёт вместе с ней, сигналом служит чистая маржа.
  "tax_rub",
  // Комиссия кабинета — тоже процент от оборота.
  "agent_commission_rub",
  // Отзывы растут вместе с продажами; сигналы — рейтинг и доля плохих.
  "reviews_count",
  // Разрез рекламы по видам кампаний — объёмные ряды, аномалии ловит общий ДРР.
  "ads_manual_spent",
  "ads_manual_views",
  "ads_manual_clicks",
  "ads_manual_orders",
  "ads_manual_orders_sum",
  "ads_unified_spent",
  "ads_unified_views",
  "ads_unified_clicks",
  "ads_unified_orders",
  "ads_unified_orders_sum",
]);

export function anomalyDirection(field: string, delta: RnpMetricDelta): "positive" | "negative" | null {
  if (delta.direction === "flat" || VOLUME_SCALED_FIELDS.has(field)) return null;
  if (POSITIVE_WHEN_DOWN.has(field)) return delta.direction === "down" ? "positive" : "negative";
  if (POSITIVE_WHEN_UP.has(field)) return delta.direction === "up" ? "positive" : "negative";
  return null;
}

export function detectSkuAnomalies(
  current: RnpOperatingSku,
  previous: RnpOperatingSku | null | undefined,
  thresholdPct = 30,
  ratioThresholdPoints = 5,
  byField: RnpAnomalyThresholds["byField"] = {},
): RnpAnomaly[] {
  if (!previous) return [];
  const previousByField = new Map(previous.metrics.map((metric) => [metric.field, metric]));
  const anomalies: RnpAnomaly[] = [];
  for (const metric of current.metrics) {
    const previousMetric = previousByField.get(metric.field);
    const delta = metricDelta(metric.total, previousMetric?.total);
    if (!delta) continue;
    const changeMagnitude = metric.kind === "pct" ? Math.abs(delta.absolute) : Math.abs(delta.percent ?? 0);
    // Порог берём по конкретной метрике, иначе — общий (проценты vs пункты).
    const threshold = byField[metric.field as RnpMetricField]
      ?? (metric.kind === "pct" ? ratioThresholdPoints : thresholdPct);
    if (changeMagnitude < threshold) continue;
    const direction = anomalyDirection(metric.field, delta);
    if (!direction) continue;
    anomalies.push({
      field: metric.field,
      label: METRIC_LABELS[metric.field] ?? metric.field,
      direction,
      delta,
      kind: "delta",
      metricKind: metric.kind,
    });
  }
  return anomalies.sort(compareAnomalyMagnitude);
}

function anomalyMagnitude(anomaly: RnpAnomaly) {
  if (anomaly.delta) return Math.abs(anomaly.delta.percent ?? anomaly.delta.absolute);
  return anomaly.days ?? 0;
}

function compareAnomalyMagnitude(left: RnpAnomaly, right: RnpAnomaly) {
  return anomalyMagnitude(right) - anomalyMagnitude(left);
}

/**
 * Пороги от общего ползунка: процентные метрики тянутся за ним, а метрики в
 * пунктах (выкуп, ДРР, CTR, маржа) сохраняют свою точную чувствительность —
 * иначе ползунок 100% полностью выключил бы сигналы по ним.
 */
export function scaleAnomalyThresholds(
  basePct: number,
  base: RnpAnomalyThresholds = DEFAULT_RNP_ANOMALY_THRESHOLDS,
): RnpAnomalyThresholds {
  const byField: RnpAnomalyThresholds["byField"] = {};
  for (const [field, value] of Object.entries(base.byField)) {
    byField[field as RnpMetricField] = POINT_THRESHOLD_FIELDS.has(field) ? value : basePct;
  }
  return { ...base, byField };
}

/**
 * Сигнал дефицита: остатка хватает меньше чем на N дней.
 * Опирается на уже рассчитанную оборачиваемость (дней покрытия).
 */
export function detectStockCoverageSignal(
  sku: RnpOperatingSku,
  maxDays: number,
): RnpAnomaly | null {
  const turnover = sku.metrics.find((metric) => metric.field === "turnover");
  const days = turnover?.total;
  if (!finite(days) || days < 0 || days >= maxDays) return null;
  return {
    field: "stock",
    label: METRIC_LABELS.stock,
    direction: "negative",
    delta: null,
    kind: "coverage",
    days: Math.round(days),
  };
}

/**
 * Серия подряд: метрика падает N дней и больше. Один день — не тренд,
 * поэтому устойчивость считается по последовательным дням в конце периода.
 */
export function detectDeclineStreakSignal(
  sku: RnpOperatingSku,
  field: RnpMetricField,
  minDays: number,
): RnpAnomaly | null {
  if (minDays < 2) return null;
  const metric = sku.metrics.find((item) => item.field === field);
  const daily = metric?.daily;
  if (!daily || daily.length < minDays + 1) return null;

  let streak = 0;
  for (let index = daily.length - 1; index > 0; index -= 1) {
    const currentValue = daily[index];
    const previousValue = daily[index - 1];
    if (!finite(currentValue) || !finite(previousValue)) break;
    if (currentValue >= previousValue) break;
    streak += 1;
  }
  if (streak < minDays) return null;
  return {
    field,
    label: METRIC_LABELS[field] ?? field,
    direction: "negative",
    delta: null,
    kind: "streak",
    days: streak,
  };
}

/**
 * Полный набор сигналов по артикулу: отклонения к прошлому периоду + дефицит
 * остатка + устойчивые серии падения по ключевым метрикам спроса.
 */
export function detectSkuSignals(
  current: RnpOperatingSku,
  previous: RnpOperatingSku | null | undefined,
  thresholds: RnpAnomalyThresholds = DEFAULT_RNP_ANOMALY_THRESHOLDS,
  basePct = 30,
  basePoints = 5,
): RnpAnomaly[] {
  const signals = detectSkuAnomalies(current, previous, basePct, basePoints, thresholds.byField);
  const coverage = detectStockCoverageSignal(current, thresholds.stockCoverageDays);
  if (coverage) signals.push(coverage);
  for (const field of ["orders_count", "open_card", "views"] as RnpMetricField[]) {
    // Не дублируем метрику, уже отмеченную отклонением.
    if (signals.some((signal) => signal.field === field)) continue;
    const streak = detectDeclineStreakSignal(current, field, thresholds.streakDays);
    if (streak) signals.push(streak);
  }
  return signals.sort(compareAnomalyMagnitude);
}

export function filterAnomalies(anomalies: RnpAnomaly[], direction: RnpAnomalyDirection) {
  return direction === "all" ? anomalies : anomalies.filter((anomaly) => anomaly.direction === direction);
}

/** Фильтр списка по конкретному показателю ("all" — без фильтра). */
export function filterAnomaliesByField(anomalies: RnpAnomaly[], field: string) {
  return field === "all" ? anomalies : anomalies.filter((anomaly) => anomaly.field === field);
}

/** Короткая подпись бейджа: «ДРР +5.2 п.п.», «заказы −47%», «остаток ~1 дн», «заказы 3 дн». */
export function formatAnomalyBadge(anomaly: RnpAnomaly): string {
  const label = METRIC_BADGE_LABELS[anomaly.field] ?? anomaly.label;
  if (anomaly.kind === "coverage") return `остаток ~${anomaly.days} дн`;
  if (anomaly.kind === "streak") return `${label} ${anomaly.days} дн`;
  const delta = anomaly.delta;
  if (!delta) return label;
  // Процентные метрики меряем в пунктах, остальные — в процентах к прошлому периоду.
  const isPoints = anomaly.metricKind === "pct" || delta.percent === null;
  const value = isPoints ? delta.absolute : delta.percent ?? 0;
  const sign = value > 0 ? "+" : "−";
  const magnitude = Math.abs(Math.round(value * 10) / 10);
  return `${label} ${sign}${magnitude}${isPoints ? " п.п." : "%"}`;
}
