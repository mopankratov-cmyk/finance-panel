export type CtrTestType = "ctr" | "cr" | "video";
export type CtrTestStatus = "draft" | "running" | "paused" | "done" | "cancelled";

export interface CtrMetricSnapshot {
  impressions: number;
  clicks: number;
  spend: number;
  opens: number;
  carts: number;
  orders: number;
  capturedAt: string;
}

export interface CtrVariantTotals {
  id: number;
  position: number;
  label: string;
  isBaseline: boolean;
  impressions: number;
  clicks: number;
  spend: number;
  opens: number;
  carts: number;
  orders: number;
  roundsCount: number;
  roundsWon: number;
}

export interface CtrCreateInput {
  cabinetId: string;
  nmId: number;
  article: string;
  name: string;
  testType: CtrTestType;
  intervalMin: number;
  impressionsPerRound: number;
  targetImpressions: number;
  spendCapRub: number;
  sourceTestId: number | null;
  variants: { label: string; imageUrl: string; source: string; isBaseline: boolean }[];
}

type NormalizeResult = { ok: true; value: CtrCreateInput } | { ok: false; error: string };

const finite = (value: unknown) => Number(value);
const clean = (value: unknown, max = 255) => String(value ?? "").normalize("NFKC").trim().slice(0, max);

function integer(value: unknown, min: number, max: number): number | null {
  const parsed = finite(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function money(value: unknown, min: number, max: number): number | null {
  const parsed = finite(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.round(parsed * 100) / 100 : null;
}

export function normalizeCtrCreatePayload(raw: Record<string, unknown>): NormalizeResult {
  const cabinetId = clean(raw.cabinetId, 80);
  const nmId = integer(raw.nmId, 1, Number.MAX_SAFE_INTEGER);
  const testType = clean(raw.testType, 20) as CtrTestType;
  const intervalMin = integer(raw.intervalMin, 5, 1_440);
  const impressionsPerRound = integer(raw.impressionsPerRound, 10, 1_000_000);
  const targetImpressions = integer(raw.targetImpressions, 100, 10_000_000);
  const spendCapRub = money(raw.spendCapRub, 100, 1_000_000);
  const sourceTestId = raw.sourceTestId == null ? null : integer(raw.sourceTestId, 1, Number.MAX_SAFE_INTEGER);
  if (!cabinetId || cabinetId === "all" || cabinetId.startsWith("group:")) return { ok: false, error: "Выберите один реальный WB-кабинет" };
  if (!nmId) return { ok: false, error: "Укажите корректный nmId" };
  if (!["ctr", "cr", "video"].includes(testType)) return { ok: false, error: "Неизвестный тип теста" };
  if (!intervalMin) return { ok: false, error: "Интервал должен быть от 5 минут до 24 часов" };
  if (!impressionsPerRound) return { ok: false, error: "Показы за раунд должны быть от 10 до 1 000 000" };
  if (!targetImpressions) return { ok: false, error: "Цель должна быть от 100 до 10 000 000 показов" };
  if (spendCapRub === null) return { ok: false, error: "Лимит расходов должен быть от 100 до 1 000 000 ₽" };
  if (raw.sourceTestId != null && !sourceTestId) return { ok: false, error: "Некорректный исходный тест маховика" };

  const sourceVariants = Array.isArray(raw.variants) ? raw.variants : [];
  if (sourceVariants.length < 2 || sourceVariants.length > 6) return { ok: false, error: "В тесте должно быть от 2 до 6 вариантов" };
  const variants = sourceVariants.map((entry, index) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      label: clean(row.label, 80) || `Вариант ${String.fromCharCode(65 + index)}`,
      imageUrl: clean(row.imageUrl, 2_000),
      source: clean(row.source, 40) || (index === 0 ? "current" : "link"),
      isBaseline: row.isBaseline === true || index === 0,
    };
  });
  if (variants.some((variant) => {
    try { return new URL(variant.imageUrl).protocol !== "https:"; } catch { return true; }
  })) return { ok: false, error: "Каждый вариант должен содержать HTTPS-ссылку на контент" };
  if (new Set(variants.map((variant) => variant.imageUrl)).size !== variants.length) return { ok: false, error: "Одинаковый контент нельзя добавить дважды" };
  variants.forEach((variant, index) => { variant.isBaseline = index === 0; });

  return {
    ok: true,
    value: {
      cabinetId,
      nmId,
      article: clean(raw.article, 255) || String(nmId),
      name: clean(raw.name, 255),
      testType,
      intervalMin,
      impressionsPerRound,
      targetImpressions,
      spendCapRub,
      sourceTestId,
      variants,
    },
  };
}

const metric = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export function normalizeCtrSnapshot(raw: Partial<CtrMetricSnapshot>): CtrMetricSnapshot {
  return {
    impressions: Math.round(metric(raw.impressions)),
    clicks: Math.round(metric(raw.clicks)),
    spend: Math.round(metric(raw.spend) * 100) / 100,
    opens: Math.round(metric(raw.opens)),
    carts: Math.round(metric(raw.carts)),
    orders: Math.round(metric(raw.orders)),
    capturedAt: clean(raw.capturedAt, 80) || new Date().toISOString(),
  };
}

export function ctrSnapshotDelta(baselineRaw: Partial<CtrMetricSnapshot>, currentRaw: Partial<CtrMetricSnapshot>) {
  const baseline = normalizeCtrSnapshot(baselineRaw);
  const current = normalizeCtrSnapshot(currentRaw);
  const corrected = (["impressions", "clicks", "spend", "opens", "carts", "orders"] as const).some((key) => current[key] < baseline[key]);
  return {
    impressions: Math.max(0, current.impressions - baseline.impressions),
    clicks: Math.max(0, current.clicks - baseline.clicks),
    spend: Math.round(Math.max(0, current.spend - baseline.spend) * 100) / 100,
    opens: Math.max(0, current.opens - baseline.opens),
    carts: Math.max(0, current.carts - baseline.carts),
    orders: Math.max(0, current.orders - baseline.orders),
    capturedAt: current.capturedAt,
    corrected,
  };
}

export function ctrVariantScore(type: CtrTestType, variant: Pick<CtrVariantTotals, "impressions" | "clicks" | "opens" | "carts" | "orders">): number | null {
  const numerator = type === "ctr" ? variant.clicks : type === "cr" ? variant.carts : variant.orders;
  const denominator = type === "ctr" ? variant.impressions : variant.opens;
  return denominator > 0 ? numerator / denominator * 100 : null;
}

export function chooseCtrWinner(type: CtrTestType, variants: CtrVariantTotals[]): CtrVariantTotals | null {
  return variants
    .map((variant) => ({ variant, score: ctrVariantScore(type, variant) }))
    .filter((row): row is { variant: CtrVariantTotals; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score || b.variant.roundsWon - a.variant.roundsWon || a.variant.position - b.variant.position)[0]?.variant ?? null;
}

export function ctrWinnerExplanation(type: CtrTestType, winner: CtrVariantTotals, baseline?: CtrVariantTotals | null): string {
  const score = ctrVariantScore(type, winner) ?? 0;
  const baselineScore = baseline ? ctrVariantScore(type, baseline) : null;
  const delta = baselineScore && baselineScore > 0 ? Math.round((score - baselineScore) / baselineScore * 100) : null;
  const comparison = delta === null ? "" : `; ${delta >= 0 ? "+" : ""}${delta}% к базовому варианту`;
  if (type === "ctr") return `Лучший CTR ${score.toFixed(2)}%: ${winner.clicks} кликов из ${winner.impressions} показов${comparison}.`;
  if (type === "cr") return `Лучшая конверсия в корзину ${score.toFixed(2)}%: ${winner.carts} корзин из ${winner.opens} открытий карточки${comparison}.`;
  return `Победитель по proxy-конверсии в заказ ${score.toFixed(2)}%: ${winner.orders} заказов из ${winner.opens} открытий${comparison}. WB API не отдаёт просмотры видео по вариантам.`;
}
