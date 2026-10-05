/**
 * Учёт отказов (улучшение 7 от 01.10.2026). Чистые функции.
 *
 * Из причин отказа и замены выводим простые и объяснимые уроки: расцветка
 * отклонённой модели, тот же силуэт после отказа «по форме», бренд, который
 * дважды не подошёл аудитории. Уроки не прячут модель — они опускают её среди
 * кандидатов и честно подписывают почему. «Слабые подтверждения» уроком не
 * становятся: подтверждения со временем растут.
 */

import { constructionKey } from "./collections";
import type { AssortmentDirection } from "./constants";
import { REJECT_REASONS } from "./decisions";
import { hasOwnKey } from "./own";

export type LessonReason = "repeats_assortment" | "shape" | "audience" | "weak_evidence" | "other";

export interface RejectionRecord {
  referenceId: string;
  direction: AssortmentDirection;
  brand: string | null;
  title: string | null;
  attributes: Record<string, string | null>;
  reason: string | null;
}

/** «replaced:shape», «shape:слишком мягкая», «other:…» → ключ причины. */
export function reasonKey(stored: string | null): LessonReason | null {
  if (!stored) return null;
  const parts = stored.split(":");
  const key = parts[0] === "replaced" ? parts[1] : parts[0];
  return key && hasOwnKey(REJECT_REASONS, key) ? (key as LessonReason) : null;
}

export const REASON_SHORT: Record<LessonReason, string> = {
  repeats_assortment: "повторяет ассортимент",
  shape: "форма",
  audience: "аудитория",
  weak_evidence: "слабые подтверждения",
  other: "другое",
};

/** Признак «формы» для раздела: у сумок силуэт, у курток подтип и длина. */
export function shapeSignature(direction: AssortmentDirection, attributes: Record<string, string | null>): { key: string; label: string } | null {
  if (direction === "bags") {
    const silhouette = attributes.silhouette?.trim();
    return silhouette && silhouette !== "не видно" ? { key: `bags|${silhouette.toLowerCase()}`, label: `силуэт «${silhouette}»` } : null;
  }
  const subtype = attributes.subtype?.trim();
  if (!subtype || subtype === "не видно") return null;
  const length = attributes.length?.trim();
  const label = length && length !== "не видно" ? `${subtype}, ${length}` : subtype;
  return { key: `jackets|${label.toLowerCase()}`, label: `«${label}»` };
}

export interface Lessons {
  constructions: Map<string, LessonReason>;
  shapes: Map<string, { label: string; count: number }>;
  audienceBrands: Map<string, { brand: string; count: number }>;
}

export function buildLessons(records: RejectionRecord[]): Lessons {
  const lessons: Lessons = { constructions: new Map(), shapes: new Map(), audienceBrands: new Map() };
  for (const record of records) {
    const reason = reasonKey(record.reason);
    if (!reason || reason === "weak_evidence") continue;
    lessons.constructions.set(constructionKey(record), reason);
    if (reason === "shape") {
      const shape = shapeSignature(record.direction, record.attributes);
      if (shape) {
        const prev = lessons.shapes.get(shape.key);
        lessons.shapes.set(shape.key, { label: prev?.label ?? shape.label, count: (prev?.count ?? 0) + 1 });
      }
    }
    if (reason === "audience" && record.brand) {
      const key = record.brand.toLowerCase().trim();
      const prev = lessons.audienceBrands.get(key);
      lessons.audienceBrands.set(key, { brand: record.brand, count: (prev?.count ?? 0) + 1 });
    }
  }
  return lessons;
}

export interface LessonHit {
  penalty: number;
  note: string;
}

/** Урок для кандидата: насколько опустить и как объяснить. null — уроков нет. */
export function lessonFor(
  candidate: { referenceId: string; direction: AssortmentDirection; brand: string | null; title: string | null; attributes: Record<string, string | null> },
  lessons: Lessons,
  ownRejectedIds: Set<string> = new Set(),
): LessonHit | null {
  if (ownRejectedIds.has(candidate.referenceId)) return null;
  const notes: string[] = [];
  let penalty = 0;
  const construction = lessons.constructions.get(constructionKey(candidate));
  if (construction) {
    penalty += 4;
    notes.push(`другая расцветка модели, которую отклонили (${REASON_SHORT[construction]})`);
  }
  const shape = shapeSignature(candidate.direction, candidate.attributes);
  const shapeLesson = shape ? lessons.shapes.get(shape.key) : undefined;
  if (shapeLesson) {
    penalty += Math.min(3, 1.5 * shapeLesson.count);
    notes.push(`${shapeLesson.label} уже отклоняли по форме${shapeLesson.count > 1 ? ` (${shapeLesson.count} раза)` : ""}`);
  }
  const brand = candidate.brand ? lessons.audienceBrands.get(candidate.brand.toLowerCase().trim()) : undefined;
  if (brand && brand.count >= 2) {
    penalty += 1;
    notes.push(`модели ${brand.brand} ${brand.count} раза не подошли аудитории`);
  }
  return penalty > 0 ? { penalty, note: `Похожа на отклонённые: ${notes.join("; ")}` } : null;
}

/** Что система вынесла из отказов — для показа человеку. */
export function lessonHighlights(lessons: Lessons): string[] {
  const out: string[] = [];
  for (const shape of [...lessons.shapes.values()].sort((a, b) => b.count - a.count).slice(0, 3)) {
    out.push(`${shape.label[0].toUpperCase()}${shape.label.slice(1)} отклоняли по форме${shape.count > 1 ? ` ${shape.count} раза` : ""} — похожие опускаем ниже`);
  }
  for (const brand of [...lessons.audienceBrands.values()].filter((b) => b.count >= 2).slice(0, 2)) {
    out.push(`Модели ${brand.brand} ${brand.count} раза не подошли аудитории`);
  }
  if (lessons.constructions.size > 0) out.push(`Расцветки отклонённых моделей (${lessons.constructions.size}) помечаем и опускаем`);
  return out;
}

/** Сводка причин отказа и замены — сколько раз какая. */
export function reasonStats(records: RejectionRecord[]): Array<{ reason: LessonReason; label: string; count: number }> {
  const counts = new Map<LessonReason, number>();
  for (const record of records) {
    const reason = reasonKey(record.reason);
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, label: REJECT_REASONS[reason], count }))
    .sort((a, b) => b.count - a.count);
}

export interface DraftCandidate {
  id: string;
  title: string;
  brand: string | null;
  score: number;
  duplicateOf: string | null;
  lesson: string | null;
  attributes: Record<string, string | null>;
}

export interface DraftPick {
  id: string;
  place: "main" | "reserve";
  why: string;
}

export interface DraftResult {
  picks: DraftPick[];
  mainFound: number;
  mainNeeded: number;
  skipped: { sameConstruction: number; lessons: number };
  summary: string;
}

/**
 * Черновик плана сумок: лучшие по сигналу, но каждая — своя конструкция;
 * при известных признаках — ещё и разное сочетание силуэта и способа ношения.
 * Похожие на отклонённые берём только если больше некого, и подписываем.
 */
export function assembleDraft(candidates: DraftCandidate[], freeMain: number, freeReserve: number): DraftResult {
  const picks: DraftPick[] = [];
  const keys = new Set<string>();
  const combos = new Set<string>();
  const skipped = { sameConstruction: 0, lessons: 0 };
  const ordered = [...candidates].sort((a, b) => b.score - a.score);
  const clean = ordered.filter((c) => !c.lesson);
  const flagged = ordered.filter((c) => c.lesson);

  const take = (pool: DraftCandidate[], limit: number, place: "main" | "reserve", strictCombo: boolean) => {
    let taken = 0;
    for (const candidate of pool) {
      if (taken >= limit) break;
      if (picks.some((p) => p.id === candidate.id)) continue;
      const key = constructionKey(candidate);
      if (candidate.duplicateOf || keys.has(key)) continue;
      const combo = [candidate.attributes.silhouette, candidate.attributes.carry].every(Boolean)
        ? `${candidate.attributes.silhouette}|${candidate.attributes.carry}`.toLowerCase()
        : null;
      if (strictCombo && combo && combos.has(combo)) continue;
      keys.add(key);
      if (combo) combos.add(combo);
      picks.push({ id: candidate.id, place, why: candidate.lesson ? `взята за неимением других; ${candidate.lesson.toLowerCase()}` : "сильный сигнал, своя конструкция" });
      taken += 1;
    }
    return taken;
  };

  let main = take(clean, freeMain, "main", true);
  if (main < freeMain) main += take(clean, freeMain - main, "main", false);
  if (main < freeMain) main += take(flagged, freeMain - main, "main", false);
  let reserve = take(clean, freeReserve, "reserve", false);
  if (reserve < freeReserve) reserve += take(flagged, freeReserve - reserve, "reserve", false);

  const picked = new Set(picks.map((p) => p.id));
  for (const candidate of ordered) {
    if (picked.has(candidate.id)) continue;
    if (candidate.duplicateOf || keys.has(constructionKey(candidate))) skipped.sameConstruction += 1;
    else if (candidate.lesson) skipped.lessons += 1;
  }

  const parts: string[] = [];
  if (main < freeMain) {
    parts.push(`Нашлось ${main} из ${freeMain} разных конструкций.`);
    if (skipped.sameConstruction > 0) parts.push(`Ещё ${skipped.sameConstruction} — расцветки уже взятых моделей.`);
    if (candidates.length === 0) parts.push("Свободных кандидатов в ленте нет — добавьте находки.");
  } else {
    parts.push(`Все ${freeMain} мест заняты разными конструкциями.`);
  }
  if (picks.some((p) => p.why.startsWith("взята за неимением"))) parts.push("Часть кандидатов похожа на отклонённые — посмотрите подписи.");
  return { picks, mainFound: main, mainNeeded: freeMain, skipped, summary: parts.join(" ") };
}
