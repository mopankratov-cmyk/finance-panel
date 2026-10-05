import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { isJudgeableField, PROMPT_VERSION } from "./catalogAi";
import { ATTRIBUTE_FIELDS } from "./attributes";
import type { AssortmentDirection } from "./constants";
import { isMissingAssortmentSchema } from "./errors";
import { summarizeVerdicts, type FieldAccuracy, type Verdict } from "./attributeVerdicts";

const TABLE = "assortment_attribute_verdict";
const RESULTS = "assortment_model_attributes";

function missing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || isMissingAssortmentSchema(new Error(error.message ?? ""));
}

export interface StoredVerdict {
  source_id: string;
  model_key: string;
  field_key: string;
  verdict: Verdict;
}

/** Отметки по разделу для текущей версии вопроса; null — таблицы ещё нет (миграция 202610050007). */
export async function loadVerdicts(db: SupabaseClient, direction: AssortmentDirection, promptVersion = PROMPT_VERSION): Promise<StoredVerdict[] | null> {
  try {
    return await loadAllSupabasePages<StoredVerdict>((from, to) => db.from(TABLE)
      .select("source_id,model_key,field_key,verdict")
      .eq("direction", direction)
      .eq("prompt_version", promptVersion)
      .order("source_id", { ascending: true })
      .order("model_key", { ascending: true })
      .order("field_key", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: StoredVerdict[] | null; error: { message: string } | null }>, { label: "Отметки точности", pageSize: 1000 });
  } catch (error) {
    if (missing({ message: error instanceof Error ? error.message : "" })) return null;
    throw error;
  }
}

/** Точность по признакам раздела (текущая версия вопроса); null — таблицы нет. */
export async function loadAccuracy(db: SupabaseClient, direction: AssortmentDirection): Promise<Record<string, FieldAccuracy> | null> {
  const rows = await loadVerdicts(db, direction);
  return rows ? summarizeVerdicts(rows) : null;
}

export class VerdictInputError extends Error {}
export class VerdictTableMissingError extends Error {}

export interface VerdictInput {
  direction: AssortmentDirection;
  sourceId: string;
  modelKey: string;
  field: string;
  /** null — снять отметку. */
  verdict: Verdict | null;
}

/**
 * Поставить или снять отметку. Версия вопроса и модель берутся из строки разбора на сервере (клиенту не верим); отметить
 * можно только признак, который ИИ действительно написал (не «не видно»), — иначе точность считалась бы по пустому.
 */
export async function saveVerdict(db: SupabaseClient, input: VerdictInput, who: string): Promise<void> {
  if (!ATTRIBUTE_FIELDS[input.direction].some((f) => f.key === input.field)) throw new VerdictInputError("Такого признака в разделе нет");
  if (!isJudgeableField(input.field)) throw new VerdictInputError("Цвет, фактура и сочетания деталей — свободный текст: сверять с ответом ИИ нечем, их точность не измеряется");
  const { data, error } = await db.from(RESULTS).select("prompt_version,model,attributes,status").eq("source_id", input.sourceId).eq("model_key", input.modelKey).eq("direction", input.direction).maybeSingle();
  if (error) {
    if (missing(error)) throw new VerdictTableMissingError("Таблицы разбора по фото ещё нет");
    throw new Error(error.message);
  }
  const row = data as { prompt_version: string; model: string | null; attributes: Record<string, { v?: string | null; nv?: boolean }> | null; status: string } | null;
  if (!row || row.status !== "ok") throw new VerdictInputError("Разбор этой модели не найден");
  const stored = row.attributes?.[input.field];
  if (!stored || stored.nv || !stored.v) throw new VerdictInputError("По этому признаку ИИ написал «не видно» — отмечать нечего");
  if (input.verdict !== null && row.prompt_version !== PROMPT_VERSION) {
    // Точность считается только по текущей версии вопроса; отметка по прежней в неё не войдёт — молча принять её значило бы обмануть.
    throw new VerdictInputError("Эта модель разобрана по прежней версии вопроса и пересоберётся — отметка в точность не войдёт");
  }
  if (input.verdict === null) {
    const { error: deleteError } = await db.from(TABLE).delete().eq("source_id", input.sourceId).eq("model_key", input.modelKey).eq("field_key", input.field).eq("prompt_version", row.prompt_version);
    if (deleteError) {
      if (missing(deleteError)) throw new VerdictTableMissingError("Отметки точности заработают после применения миграции 202610050007");
      throw new Error(deleteError.message);
    }
    return;
  }
  const { error: upsertError } = await db.from(TABLE).upsert({
    source_id: input.sourceId, model_key: input.modelKey, direction: input.direction, field_key: input.field,
    prompt_version: row.prompt_version, ai_model: row.model, verdict: input.verdict, judged_by: who, judged_at: new Date().toISOString(),
  }, { onConflict: "source_id,model_key,field_key,prompt_version" });
  if (upsertError) {
    if (missing(upsertError)) throw new VerdictTableMissingError("Отметки точности заработают после применения миграции 202610050007");
    throw new Error(upsertError.message);
  }
}
