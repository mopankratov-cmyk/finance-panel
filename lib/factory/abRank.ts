// A/B-петля хит-рейта: ранжирование вариантов по рыночным метрикам → винеры (множить) / лузеры (убить).
// Операционализирует главный вывод юнитки: «узкое место — хит-рейт, не деньги» (см. [[factory-unit-economics]]).
// Чистая логика (без I/O) → юнит-тестируемо (abRank.test.mts). Использует роут /api/factory/ab-rank.

export interface VariantMetric {
  recipe_id: number;
  hook?: string;
  views: number;
  watch_rate?: number | null;   // удержание (доля 0..1 ИЛИ % 0..100 — нормализуем)
  ctr_card?: number | null;     // CTR в карточку (0..1 или %)
  saves?: number | null;
}
export type Tier = "winner" | "mid" | "loser";
export interface RankedVariant extends VariantMetric { score: number; rank: number; tier: Tier; }

// нормализуем долю: >1 трактуем как проценты (45 → 0.45), клампим [0,1]
function frac(v: number | null | undefined): number {
  if (v == null || !isFinite(Number(v))) return 0;
  let n = Number(v);
  if (n > 1) n = n / 100;
  return Math.max(0, Math.min(1, n));
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// score = охват × качество удержания (+ небольшой вклад CTR). Винер — это выброс по охвату,
// поэтому views берём как есть (не лог — мы ХОТИМ, чтобы выброс торчал), а удержание/CTR множат.
export function variantScore(m: VariantMetric): number {
  const views = Math.max(0, Number(m.views) || 0);
  const wr = frac(m.watch_rate);
  const ctr = frac(m.ctr_card);
  return views * (1 + wr + 0.5 * ctr);
}

// Ранжирование портфеля. Винеры = топ-20% И score ≥ median (чтобы в плоском наборе не короновать слабых).
// Лузеры = низ loserFrac (дефолт 0.6 — «режь нижние 60%» из перформанс-практики) И score < median.
export function rankVariants(
  rows: VariantMetric[],
  opts?: { winnerTopFrac?: number; loserFrac?: number; minWinnerViews?: number },
): { ranked: RankedVariant[]; medianScore: number; summary: { winners: number; mid: number; losers: number; total: number } } {
  const winnerTopFrac = opts?.winnerTopFrac ?? 0.2;
  const loserFrac = opts?.loserFrac ?? 0.6;
  const minWinnerViews = Math.max(0, Number(opts?.minWinnerViews ?? 100) || 0);
  const scored = (rows || []).map((m) => ({ ...m, score: variantScore(m) }));
  scored.sort((a, b) => b.score - a.score);
  const n = scored.length;
  const med = median(scored.map((s) => s.score));
  const winnerCut = Math.max(1, Math.ceil(n * winnerTopFrac));   // сколько верхних считать винерами (если бьют медиану)
  const loserStart = Math.ceil(n * (1 - loserFrac));             // индекс, с которого начинается низ-loserFrac

  const ranked: RankedVariant[] = scored.map((s, i) => {
    const rank = i + 1;
    let tier: Tier = "mid";
    if (n >= 2) {
      if (i < winnerCut && s.score > med && s.score > 0 && (Number(s.views) || 0) >= minWinnerViews) tier = "winner";
      else if (i >= loserStart && s.score < med) tier = "loser";
    }
    return { ...s, rank, tier };
  });
  const summary = {
    winners: ranked.filter((r) => r.tier === "winner").length,
    mid: ranked.filter((r) => r.tier === "mid").length,
    losers: ranked.filter((r) => r.tier === "loser").length,
    total: n,
  };
  return { ranked, medianScore: med, summary };
}
