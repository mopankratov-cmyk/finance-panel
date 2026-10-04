import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssortmentDirection } from "./constants";
import { isMissingAssortmentSchema } from "./errors";
import {
  compactQueries, expandQueries, pickPrevious, subjectsFor,
  type SnapshotMeta, type SnapshotTask, type SubjectQueries,
} from "./wbQueries";
import type { KeywordRow } from "./wbDemand";

/**
 * Хранилище недельных срезов частотности запросов WB (миграция 202610050003).
 * Читает экран, пишет сборщик /api/sync/assortment-wb-queries. Пока миграцию не
 * применили, таблицы нет: чтение отдаёт «данных нет», сборщик молча пропускает
 * прогон — ни то ни другое не ошибка.
 */

const TABLE = "assortment_wb_query_snapshot";

function tableMissing(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || isMissingAssortmentSchema(new Error(error.message ?? ""));
}

/** Какие срезы уже есть; null — таблицы ещё нет. */
export async function loadSnapshotMeta(db: SupabaseClient): Promise<SnapshotMeta[] | null> {
  const { data, error } = await db.from(TABLE).select("subject_id,window_to");
  if (error) {
    if (tableMissing(error)) return null;
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => ({ subjectId: Number((row as { subject_id: number }).subject_id), windowTo: String((row as { window_to: string }).window_to) }));
}

export async function saveSnapshot(db: SupabaseClient, task: SnapshotTask, rows: KeywordRow[]): Promise<number> {
  const queries = compactQueries(rows);
  const { error } = await db.from(TABLE).upsert({
    subject_id: task.subject.id,
    window_to: task.windowTo,
    window_from: task.windowFrom,
    direction: task.subject.direction,
    subject_name: task.subject.name,
    queries,
    rows_total: rows.length,
    rows_kept: queries.length,
    taken_at: new Date().toISOString(),
  }, { onConflict: "subject_id,window_to" });
  if (error) throw new Error(error.message);
  return queries.length;
}

export interface CollectDeps {
  /** Весь список запросов предмета за окно (MPSTATS; ответ ~10 МБ, до полутора минут). */
  fetchKeywords: (subjectId: number, d1: string, d2: string) => Promise<KeywordRow[]>;
  now?: () => number;
  /** После этого времени с начала прогона новый предмет не начинаем: один ответ MPSTATS занимает до 100 с. */
  startBudgetMs?: number;
}

export interface CollectResult {
  planned: number;
  done: Array<{ subject: string; kind: SnapshotTask["kind"]; windowTo: string; kept: number; total: number }>;
  failed: Array<{ subject: string; kind: SnapshotTask["kind"]; error: string }>;
  /** Почему прогон остановился раньше конца списка; null — дошли до конца. */
  stoppedBy: "budget" | "rate_limit" | "auth" | null;
}

/** Лимит запросов и недействительный токен MPSTATS — дальше идти бессмысленно (признак по имени: не зависит от копии модуля). */
function stopCode(error: unknown): "rate_limit" | "auth" | null {
  if (!(error instanceof Error) || error.name !== "MpstatsApiError") return null;
  const code = (error as Error & { code?: string }).code;
  return code === "rate_limit" || code === "auth" ? code : null;
}

/** Снять срезы по плану: по одному, последовательно; квота MPSTATS общая, лишней нагрузки не создаём. */
export async function collectWbQuerySnapshots(db: SupabaseClient, tasks: SnapshotTask[], deps: CollectDeps): Promise<CollectResult> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const budget = deps.startBudgetMs ?? 85_000;
  const result: CollectResult = { planned: tasks.length, done: [], failed: [], stoppedBy: null };
  for (const task of tasks) {
    if (now() - startedAt > budget) {
      result.stoppedBy = "budget";
      break;
    }
    try {
      const rows = await deps.fetchKeywords(task.subject.id, task.windowFrom, task.windowTo);
      // Пустой ответ — не срез: записав его, мы бы объявили предмет «снятым» на неделю.
      if (rows.length === 0) throw new Error("MPSTATS вернул пустой список запросов");
      const kept = await saveSnapshot(db, task, rows);
      result.done.push({ subject: task.subject.name, kind: task.kind, windowTo: task.windowTo, kept, total: rows.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "сбой";
      result.failed.push({ subject: task.subject.name, kind: task.kind, error: message.slice(0, 200) });
      const code = stopCode(error);
      if (code) {
        result.stoppedBy = code;
        break;
      }
    }
  }
  return result;
}

interface MetaRow {
  subject_id: number;
  subject_name: string;
  window_from: string;
  window_to: string;
}

/** Свежие и «прошлые» срезы предметов раздела; пусто, если сборщик ещё ничего не снял. */
export async function readDemandSubjects(db: SupabaseClient, direction: AssortmentDirection): Promise<SubjectQueries[]> {
  const known = subjectsFor(direction);
  const { data, error } = await db.from(TABLE).select("subject_id,subject_name,window_from,window_to").eq("direction", direction);
  if (error) {
    if (tableMissing(error)) return [];
    throw new Error(error.message);
  }
  const metas = (data ?? []) as MetaRow[];
  const picked = known.map((subject) => {
    const mine = metas.filter((m) => Number(m.subject_id) === subject.id).map((m) => ({ ...m, windowTo: String(m.window_to) }));
    const latest = mine.slice().sort((a, b) => b.windowTo.localeCompare(a.windowTo))[0];
    if (!latest) return null;
    return { subject, latest, previous: pickPrevious(mine, latest.windowTo) };
  }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const loaded = await Promise.all(picked.map(async ({ subject, latest, previous }) => {
    const dates = [latest.windowTo, ...(previous ? [previous.windowTo] : [])];
    const { data: rows, error: rowsError } = await db.from(TABLE).select("window_to,queries").eq("subject_id", subject.id).in("window_to", dates);
    if (rowsError) throw new Error(rowsError.message);
    const byDate = new Map((rows ?? []).map((row) => [String((row as { window_to: string }).window_to), expandQueries((row as { queries: unknown }).queries)]));
    const current = byDate.get(latest.windowTo);
    if (!current || current.length === 0) return null;
    const before = previous ? byDate.get(previous.windowTo) ?? null : null;
    const out: SubjectQueries = {
      subject: subject.name,
      windowFrom: String(latest.window_from),
      windowTo: latest.windowTo,
      current,
      previousTo: before && before.length ? previous!.windowTo : null,
      previous: before && before.length ? before : null,
    };
    return out;
  }));
  return loaded.filter((entry): entry is SubjectQueries => entry !== null);
}
