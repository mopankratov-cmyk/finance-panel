export type AdvertRecommendationAction = "increase" | "hold" | "decrease" | "pause" | "insufficient";
export type AdvertStockRisk = "out" | "critical" | "warning" | "ok" | "unknown";
export type AdvertConfidence = "high" | "medium" | "low" | "unavailable";

export interface AdvertProfitInput {
  price: number;
  cost: number | null;
  revenue: number;
  spent: number;
  units?: number | null;
  commissionPct: number;
  acquiringPct: number;
  extraPct: number;
  taxPct: number;
  logisticsPerUnit?: number;
  feesComplete?: boolean;
  stock?: number | null;
  dailyUnits?: number | null;
  attributionCompatible?: boolean;
  dataAgeHours?: number | null;
  /**
   * Плановый ритм сбора данных этой площадки, в часах: возраст в пределах
   * ритма — норма, а не повод занижать уверенность. У WB статистика приезжает
   * каждый час (значение по умолчанию), у Ozon рекламное окно пересобирается
   * раз в сутки — с общим порогом «старше 6 часов» рекомендация «увеличить»
   * там не появлялась никогда.
   */
  dataCadenceHours?: number;
}

export interface AdvertProfitGuardrail {
  breakEvenDrr: number | null;
  breakEvenRoas: number | null;
  profitAfterAds: number | null;
  currentDrr: number | null;
  currentRoas: number | null;
  daysCover: number | null;
  stockRisk: AdvertStockRisk;
  action: AdvertRecommendationAction;
  budgetChangePct: number | null;
  expectedProfitEffect: number | null;
  reason: string;
  confidence: AdvertConfidence;
  confidencePct: number;
}

export interface AdvertPeriodPoint {
  date: string;
  spent: number;
  revenue: number;
}

export interface AdvertBeforeAfter {
  changedAt: string;
  before: { days: number; spent: number; revenue: number; drr: number | null };
  after: { days: number; spent: number; revenue: number; drr: number | null };
  drrDelta: number | null;
}

const r1 = (value: number) => Math.round(value * 10) / 10;
const r0 = (value: number) => Math.round(value);
const drr = (spent: number, revenue: number) => revenue > 0 ? r1(spent / revenue * 100) : null;

function stockRisk(daysCover: number | null, stock: number | null | undefined, dailyUnits: number | null | undefined): AdvertStockRisk {
  if (stock == null || dailyUnits == null) return "unknown";
  if (stock <= 0 && dailyUnits > 0) return "out";
  if (daysCover == null) return "unknown";
  if (daysCover <= 7) return "critical";
  if (daysCover <= 14) return "warning";
  return "ok";
}

function confidenceFor(input: AdvertProfitInput) {
  if (input.cost == null || input.cost <= 0 || input.price <= 0) return { value: 0, label: "unavailable" as const };
  let value = 100;
  if (input.stock == null || input.dailyUnits == null) value -= 20;
  if (input.feesComplete === false) value -= 35;
  if (input.attributionCompatible === false) value -= 25;
  // Возраст данных штрафуется от планового ритма площадки, а не от «идеала»:
  // просроченным считается то, что не пришло в срок, а не то, что старше
  // нескольких часов.
  const cadence = input.dataCadenceHours && input.dataCadenceHours > 0 ? input.dataCadenceHours : 2;
  if (input.dataAgeHours == null) value -= 10;
  else if (input.dataAgeHours > cadence * 3) value -= 30;
  else if (input.dataAgeHours > cadence) value -= 15;
  if (input.revenue <= 0) value -= 20;
  value = Math.max(0, value);
  return { value, label: value >= 80 ? "high" as const : value >= 55 ? "medium" as const : "low" as const };
}

export function calculateAdvertProfitGuardrail(input: AdvertProfitInput): AdvertProfitGuardrail {
  const dailyUnits = input.dailyUnits != null && input.dailyUnits > 0 ? input.dailyUnits : null;
  const daysCover = input.stock != null && dailyUnits ? r1(input.stock / dailyUnits) : null;
  const risk = stockRisk(daysCover, input.stock, input.dailyUnits);
  const confidence = confidenceFor(input);

  if (input.cost == null || input.cost <= 0 || input.price <= 0 || input.feesComplete === false) {
    const reason = input.feesComplete === false
      ? "Нет полной комиссии или логистики: безопасная рекомендация по рекламе недоступна."
      : "Нет себестоимости: безопасная рекомендация по рекламе недоступна.";
    return {
      breakEvenDrr: null,
      breakEvenRoas: null,
      profitAfterAds: null,
      currentDrr: drr(input.spent, input.revenue),
      currentRoas: input.spent > 0 ? r1(input.revenue / input.spent) : null,
      daysCover,
      stockRisk: risk,
      action: "insufficient",
      budgetChangePct: null,
      expectedProfitEffect: null,
      reason,
      confidence: confidence.label,
      confidencePct: confidence.value,
    };
  }

  const percentCosts = input.commissionPct + input.acquiringPct + input.extraPct + input.taxPct;
  const contributionPerUnit = input.price
    - input.cost
    - input.price * percentCosts / 100
    - Number(input.logisticsPerUnit ?? 0);
  const contributionPct = input.price > 0 ? contributionPerUnit / input.price : 0;
  const breakEvenDrr = Math.max(0, r1(contributionPct * 100));
  const breakEvenRoas = breakEvenDrr > 0 ? r1(100 / breakEvenDrr) : null;
  const currentDrr = drr(input.spent, input.revenue);
  const currentRoas = input.spent > 0 ? r1(input.revenue / input.spent) : null;
  const profitAfterAds = r0(input.revenue * contributionPct - input.spent);

  let action: AdvertRecommendationAction = "hold";
  let budgetChangePct = 0;
  let reason = "Текущий расход находится внутри безопасного диапазона маржи и остатка.";
  if (contributionPerUnit <= 0) {
    action = "pause";
    budgetChangePct = -100;
    reason = "Товар убыточен ещё до рекламы — продвижение увеличивает убыток.";
  } else if (risk === "out" || risk === "critical") {
    action = risk === "out" ? "pause" : "decrease";
    budgetChangePct = risk === "out" ? -100 : -30;
    reason = risk === "out"
      ? "Товар закончился: рекламный расход нужно остановить до пополнения."
      : `Запаса примерно на ${daysCover} дн.: рост рекламы повышает риск out-of-stock.`;
  } else if (input.spent > 0 && input.revenue <= 0) {
    action = "decrease";
    budgetChangePct = -30;
    reason = "Есть расход без атрибутированной выручки — сначала проверьте кампанию и атрибуцию.";
  } else if (currentDrr != null && (currentDrr > breakEvenDrr * 1.1 || profitAfterAds < 0)) {
    action = "decrease";
    budgetChangePct = -20;
    reason = `ДРР ${currentDrr}% выше безопасного ${breakEvenDrr}% или реклама уже съедает вклад в прибыль.`;
  } else if (
    currentDrr != null
    && currentDrr < breakEvenDrr * 0.65
    && daysCover != null
    && daysCover > 30
    && input.attributionCompatible !== false
    && confidence.label === "high"
    && input.spent > 0
  ) {
    action = "increase";
    budgetChangePct = 15;
    reason = `ДРР заметно ниже break-even ${breakEvenDrr}%, запас позволяет аккуратный рост.`;
  }

  const spendDelta = input.spent * Math.abs(budgetChangePct) / 100;
  let expectedProfitEffect: number | null = 0;
  if (action === "increase") {
    expectedProfitEffect = currentRoas == null ? null : r0(spendDelta * currentRoas * contributionPct - spendDelta);
  } else if (action === "decrease" || action === "pause") {
    expectedProfitEffect = currentRoas == null
      ? r0(spendDelta)
      : r0(spendDelta - spendDelta * currentRoas * contributionPct);
  }

  return {
    breakEvenDrr,
    breakEvenRoas,
    profitAfterAds,
    currentDrr,
    currentRoas,
    daysCover,
    stockRisk: risk,
    action,
    budgetChangePct,
    expectedProfitEffect,
    reason,
    confidence: confidence.label,
    confidencePct: confidence.value,
  };
}

export function compareAdvertBeforeAfter(points: AdvertPeriodPoint[], changedAt: string): AdvertBeforeAfter | null {
  const changeDate = changedAt.slice(0, 10);
  const ordered = points.slice().sort((left, right) => left.date.localeCompare(right.date));
  const beforePoints = ordered.filter((point) => point.date < changeDate).slice(-7);
  const afterPoints = ordered.filter((point) => point.date >= changeDate).slice(0, 7);
  if (beforePoints.length < 2 || afterPoints.length < 2) return null;
  const summarize = (items: AdvertPeriodPoint[]) => {
    const spent = items.reduce((sum, item) => sum + item.spent, 0);
    const revenue = items.reduce((sum, item) => sum + item.revenue, 0);
    return { days: items.length, spent: r0(spent), revenue: r0(revenue), drr: drr(spent, revenue) };
  };
  const before = summarize(beforePoints);
  const after = summarize(afterPoints);
  return {
    changedAt,
    before,
    after,
    drrDelta: before.drr != null && after.drr != null ? r1(after.drr - before.drr) : null,
  };
}
