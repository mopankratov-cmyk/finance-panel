// Чистый движок CTR-теста: ротация вариантов главного фото на платном трафике + выбор победителя.
// Без I/O → юнит-тестируемо. Решает ЧТО делать; смена фото/замер — в оркестраторе (cron), за гейтами.

export interface CtrVariant { id: number; views: number; clicks: number }
export interface CtrTestState {
  status: string;          // draft | running | done
  enabled: boolean;
  intervalMin: number;     // как часто ротировать главное фото
  minImpr: number;         // порог значимости (сумма показов по вариантам)
  curVariantId: number | null;
  curStartedAtMs: number | null;
}
export type CtrAction = "idle" | "rotate" | "continue" | "finish";
export interface CtrStep { action: CtrAction; nextVariantId?: number; winnerId?: number; reason: string }

export const variantCtr = (v: CtrVariant): number => (v.views > 0 ? v.clicks / v.views : 0);
export const totalImpr = (vs: CtrVariant[]): number => vs.reduce((s, v) => s + (v.views || 0), 0);

// Победитель по CTR среди вариантов с достаточным охватом; тай-брейк — по показам.
export function pickWinner(vs: CtrVariant[], minViewsPerVariant = 100): number | null {
  const eligible = vs.filter((v) => v.views >= minViewsPerVariant);
  const pool = eligible.length ? eligible : vs.filter((v) => v.views > 0);
  if (!pool.length) return null;
  let best = pool[0];
  for (const v of pool) {
    const c = variantCtr(v), bc = variantCtr(best);
    if (c > bc || (c === bc && v.views > best.views)) best = v;
  }
  return best.id;
}

export function decideCtrStep(test: CtrTestState, variants: CtrVariant[], nowMs: number): CtrStep {
  if (!test.enabled || test.status !== "running") return { action: "idle", reason: "тест не запущен/выключен" };
  if (variants.length < 2) return { action: "idle", reason: "нужно ≥2 вариантов" };

  if (totalImpr(variants) >= test.minImpr) {
    const w = pickWinner(variants);
    return { action: "finish", winnerId: w ?? undefined, reason: `${totalImpr(variants)} ≥ ${test.minImpr} показов → победитель` };
  }

  const order = variants.map((v) => v.id);
  const idx = test.curVariantId != null ? order.indexOf(test.curVariantId) : -1;
  if (idx < 0) return { action: "rotate", nextVariantId: order[0], reason: "старт ротации" };

  const elapsedMin = test.curStartedAtMs != null ? (nowMs - test.curStartedAtMs) / 60000 : Infinity;
  if (elapsedMin >= test.intervalMin) {
    const next = order[(idx + 1) % order.length];
    return { action: "rotate", nextVariantId: next, reason: `круг ${Math.round(elapsedMin)}мин ≥ ${test.intervalMin} → следующий вариант` };
  }
  return { action: "continue", reason: `текущий вариант ещё ~${Math.max(0, Math.round(test.intervalMin - elapsedMin))}мин` };
}
