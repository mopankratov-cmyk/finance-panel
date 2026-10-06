/**
 * Точность разбора по фото, измеренная человеком (движок тенденций). Чистые функции.
 *
 * Человек смотрит на фото и на то, что написал ИИ, и отмечает по одному признаку: верно / неверно / по фото не понять.
 * «Не понять» в точность не входит. Точность — доля верных среди верных и неверных; к ней — нижняя граница 95% интервала
 * Уилсона: 12 безошибочных примеров ещё допускают ошибку до ~25%, и пока границы не хватает, доли признака не показываются.
 * Если «не понять» слишком много, признак по фото человеку не проверить — доли тоже прячем: уверенное «верно» по таким
 * отметкам ничего не доказывает. Пороги — наше решение, не свойство данных.
 */

export type Verdict = "ok" | "wrong" | "unclear";
export const VERDICTS: readonly Verdict[] = ["ok", "wrong", "unclear"];

/** Сколько отметок «верно/неверно» по признаку нужно, чтобы считать его точность измеренной. */
export const ACCURACY_MIN_JUDGED = 20;
/** Нижняя граница точности (интервал Уилсона 95%), ниже которой доли признака прячем. */
export const ACCURACY_LOWER_MIN = 0.8;
/** С скольки отметок «верно/неверно» можно прятать признак раньше срока: если даже верхняя граница интервала ниже порога. */
export const ACCURACY_EARLY_MIN = 5;
/** Доля «не понять» среди всех отметок признака, выше которой признак по фото не проверить (считается от ACCURACY_MIN_JUDGED отметок). */
export const ACCURACY_UNCLEAR_MAX = 0.3;

export interface VerdictRow {
  field_key: string;
  verdict: Verdict;
  /** Версия вопроса и модель ИИ, по разбору которых поставлена отметка: точность считается отдельно для каждой пары. */
  prompt_version?: string | null;
  ai_model?: string | null;
}

export interface FieldAccuracy {
  /** Размечено «верно» + «неверно». */
  judged: number;
  ok: number;
  wrong: number;
  unclear: number;
  /** ok / judged, 0..1; null — отметок «верно/неверно» нет. */
  accuracy: number | null;
  /** Нижняя граница 95% интервала Уилсона, 0..1; null — отметок нет. */
  lower: number | null;
  /** Верхняя граница того же интервала, 0..1; null — отметок нет. */
  upper: number | null;
  status: "unmeasured" | "reliable" | "unreliable";
  /** Почему «unreliable»: low — точность ниже порога; unverifiable — слишком много «не понять»; иначе null. */
  reason: "low" | "unverifiable" | null;
}

/** Нижняя граница 95% интервала Уилсона для доли ok из n. */
export function wilsonLower(ok: number, n: number, z = 1.96): number | null {
  if (n <= 0) return null;
  const p = ok / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (centre - margin) / denom);
}

/** Верхняя граница 95% интервала Уилсона для доли ok из n. */
export function wilsonUpper(ok: number, n: number, z = 1.96): number | null {
  if (n <= 0) return null;
  const p = ok / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.min(1, (centre + margin) / denom);
}

export function fieldAccuracy(ok: number, wrong: number, unclear: number): FieldAccuracy {
  const judged = ok + wrong;
  const accuracy = judged > 0 ? ok / judged : null;
  const lower = wilsonLower(ok, judged);
  const upper = wilsonUpper(ok, judged);
  const marks = judged + unclear;
  let status: FieldAccuracy["status"];
  let reason: FieldAccuracy["reason"] = null;
  if (marks >= ACCURACY_MIN_JUDGED && unclear / marks > ACCURACY_UNCLEAR_MAX) {
    // «Верно» из 20 при 80 «не понять» — это точность по самым очевидным случаям, а не по признаку.
    status = "unreliable";
    reason = "unverifiable";
  } else if (judged < ACCURACY_MIN_JUDGED) {
    // Мало отметок, но уже видно, что и в лучшем случае до порога не дотянуть, — ждать двадцатой незачем.
    const hopeless = judged >= ACCURACY_EARLY_MIN && (upper ?? 1) < ACCURACY_LOWER_MIN;
    status = hopeless ? "unreliable" : "unmeasured";
    if (hopeless) reason = "low";
  } else if ((lower ?? 0) >= ACCURACY_LOWER_MIN) {
    status = "reliable";
  } else {
    status = "unreliable";
    reason = "low";
  }
  return { judged, ok, wrong, unclear, accuracy, lower, upper, status, reason };
}

/** Точность одной пары «версия вопроса + модель ИИ». */
export interface VerdictSummary {
  promptVersion: string | null;
  aiModel: string | null;
  /** Всего отметок этой пары (с «не понять»). */
  marks: number;
  byField: Record<string, FieldAccuracy>;
}

/**
 * Точность по признакам из отметок — отдельно для каждой пары «версия вопроса + модель ИИ». Сменили модель, не меняя вопроса, —
 * это другой разборщик: его ошибки не должны размываться отметками прежней модели (и наоборот), поэтому смешанной точности здесь нет
 * вовсе. Порядок — по числу отметок, больше первыми.
 */
export function summarizeVerdicts(rows: VerdictRow[]): VerdictSummary[] {
  const groups = new Map<string, { promptVersion: string | null; aiModel: string | null; marks: number; counts: Map<string, { ok: number; wrong: number; unclear: number }> }>();
  for (const row of rows) {
    if (!VERDICTS.includes(row.verdict)) continue;
    const promptVersion = row.prompt_version ?? null;
    const aiModel = row.ai_model ?? null;
    const key = `${promptVersion ?? ""}\u0000${aiModel ?? ""}`;
    const group = groups.get(key) ?? { promptVersion, aiModel, marks: 0, counts: new Map() };
    const c = group.counts.get(row.field_key) ?? { ok: 0, wrong: 0, unclear: 0 };
    c[row.verdict] += 1;
    group.counts.set(row.field_key, c);
    group.marks += 1;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({ promptVersion: g.promptVersion, aiModel: g.aiModel, marks: g.marks, byField: Object.fromEntries([...g.counts.entries()].map(([field, c]) => [field, fieldAccuracy(c.ok, c.wrong, c.unclear)])) }))
    .sort((a, b) => b.marks - a.marks || String(a.aiModel ?? "").localeCompare(String(b.aiModel ?? "")));
}

/** Точность одной пары из сводки; отметок этой пары нет — пустая запись (точность не измерена), а не чужая. */
export function accuracyFor(summaries: VerdictSummary[], promptVersion: string | null, aiModel: string | null): Record<string, FieldAccuracy> {
  return summaries.find((s) => s.promptVersion === promptVersion && s.aiModel === aiModel)?.byField ?? {};
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
/** Границы интервала округляем вниз: «79,7%» не должно превратиться в «80%» рядом со словами «ниже порога 80%». */
const pctFloor = (n: number) => `${Math.floor(n * 100 + 1e-9)}%`;

/** Подпись точности признака одной строкой — для карточки признака. */
export function accuracyLabel(a: FieldAccuracy | undefined): string {
  const unclearNote = a && a.unclear > 0 ? `; не понять: ${a.unclear}` : "";
  if (!a || a.judged === 0) return `точность не измерена: размечено 0 из ${ACCURACY_MIN_JUDGED}${unclearNote}`;
  const base = `верно ${a.ok} из ${a.judged} (${pct(a.accuracy ?? 0)}, нижняя граница ${pctFloor(a.lower ?? 0)})`;
  return `${a.status === "unmeasured" ? `${base} — пока мало: нужно ${ACCURACY_MIN_JUDGED}` : base}${unclearNote}`;
}

/** Причина, по которой доли признака не показываются; null — показываем. */
export function hiddenReason(a: FieldAccuracy | undefined): string | null {
  if (!a || a.status !== "unreliable") return null;
  if (a.reason === "unverifiable") {
    const share = a.unclear / Math.max(1, a.judged + a.unclear);
    const shown = (share * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
    return `по ${a.judged + a.unclear} отметкам «не понять» у ${shown}% (порог — ${pct(ACCURACY_UNCLEAR_MAX)}): этот признак по фото человеку не проверить, и верить долям нельзя`;
  }
  if (a.judged < ACCURACY_MIN_JUDGED) {
    return `по ${a.judged} размеченным моделям верно ${pct(a.accuracy ?? 0)}: даже в лучшем случае (верхняя граница ${pctFloor(a.upper ?? 0)}) это ниже порога ${pct(ACCURACY_LOWER_MIN)}`;
  }
  return `по ${a.judged} размеченным моделям верно ${pct(a.accuracy ?? 0)}, нижняя граница ${pctFloor(a.lower ?? 0)} ниже порога ${pct(ACCURACY_LOWER_MIN)}`;
}
