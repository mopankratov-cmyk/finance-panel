import type { SupabaseClient } from "@supabase/supabase-js";
import { formatValue, type Attributes } from "./attributes";
import type { AssortmentDirection } from "./constants";
import { buildLessons, reasonKey, reasonStats, type Lessons, type RejectionRecord } from "./learning";

const WINDOW_DAYS = 180;

export interface LearningContext {
  lessons: Lessons;
  ownIds: Set<string>;
  stats: ReturnType<typeof reasonStats>;
}

/**
 * Отказы и замены раздела за полгода. Отказ учитываем, пока модель отклонена:
 * вернули в ленту — урок снят. Замену — пока модель снова не взяли в работу.
 */
export async function loadLearning(db: SupabaseClient, direction: AssortmentDirection): Promise<LearningContext> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const { data, error } = await db.from("assortment_decisions")
    .select("reference_id,decision,reason,created_at")
    .not("reference_id", "is", null)
    .in("decision", ["rejected", "postponed"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const latest = new Map<string, { decision: string; reason: string | null }>();
  for (const row of data ?? []) {
    const id = String(row.reference_id);
    if (!latest.has(id) && reasonKey(row.reason ? String(row.reason) : null)) latest.set(id, { decision: String(row.decision), reason: row.reason ? String(row.reason) : null });
  }
  const ids = [...latest.keys()];
  if (ids.length === 0) return { lessons: buildLessons([]), ownIds: new Set(), stats: [] };

  const { data: refs, error: refError } = await db.from("assortment_references")
    .select("id,direction,brand,title,status,attributes")
    .in("id", ids)
    .eq("direction", direction);
  if (refError) throw new Error(refError.message);
  const records: RejectionRecord[] = [];
  for (const ref of refs ?? []) {
    const decision = latest.get(String(ref.id));
    if (!decision) continue;
    const status = String(ref.status);
    const active = decision.decision === "rejected" ? status === "rejected" : status === "watching" || status === "new";
    if (!active) continue;
    const attributes: Record<string, string | null> = {};
    for (const [key, entry] of Object.entries((ref.attributes ?? {}) as Attributes)) attributes[key] = formatValue(entry);
    records.push({ referenceId: String(ref.id), direction, brand: ref.brand ? String(ref.brand) : null, title: ref.title ? String(ref.title) : null, attributes, reason: decision.reason });
  }
  return { lessons: buildLessons(records), ownIds: new Set(records.map((r) => r.referenceId)), stats: reasonStats(records) };
}
