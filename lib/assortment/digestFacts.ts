import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attributes } from "./attributes";
import { partLabel } from "./brightdataCatalog";
import { rowsByIds } from "./byIds";
import { COLLECTION_STATUS_LABEL } from "./collections";
import { listCollections } from "./collectionsStore";
import type { AssortmentDirection } from "./constants";
import { topFindings, type DigestDirection, type DigestFacts, type DigestFinding } from "./digest";
import { reasonKey, REASON_SHORT, type LessonReason } from "./learning";
import { isMissingColumnError } from "./errors";
import { loadHistoryState } from "./observationStateStore";
import { isRuSource, RU_SOURCE_IDS } from "./ruMarket";
import { cardSignal, type ObservationLite } from "./signals";

/** Пульс автообхода по источникам; null — колонок пульса нет или обход не запускался. */
async function loadCrawlHealth(db: SupabaseClient, since: string): Promise<DigestFacts["crawl"]> {
  const { data, error } = await db.from("assortment_sources").select("source_id,name,last_attempt_at,last_error").not("last_attempt_at", "is", null);
  if (error) {
    if (isMissingColumnError(error)) return null;
    throw new Error(error.message);
  }
  // «Рынок РФ» (WB, Lime на WB) — замер рынка, а не автообход каталога: Lime на WB каждую неделю честно пишет «нет продаж», и в сводке
  // это была бы вечная ⚠️; сторож (freshness) его по той же причине не смотрит.
  const crawled = (data ?? []).filter((row) => !isRuSource(row.source_id ? String(row.source_id) : null));
  if (crawled.length === 0) return null;
  const ok: string[] = [];
  const failing: Array<{ name: string; error: string }> = [];
  for (const row of crawled) {
    const name = String(row.name);
    if (row.last_error) failing.push({ name, error: String(row.last_error) });
    else if (String(row.last_attempt_at) < since) failing.push({ name, error: "обход не запускался больше недели" });
    else ok.push(name);
  }
  return { ok, failing };
}

const emptyDirection = (): DigestDirection => ({ newCount: 0, retailCount: 0, top: [], selected: 0, sampleNeeded: 0, rejected: 0, topReason: null });

/** Факты недели [from, to): новые модели, решения людей, подборки. */
export async function loadDigestFacts(db: SupabaseClient, from: Date, to: Date, baseUrl: string): Promise<DigestFacts> {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  // «Рынок РФ» отсекаем в запросе, а не после него: каждую неделю он вписывает в «новые» сотни позиций и вытеснял бы настоящие находки
  // из первой тысячи ответа (порядок без сортировки был произвольным).
  const { data: refs, error } = await db.from("assortment_references")
    .select("id,direction,title,brand,source_id,attributes,first_seen_at")
    .gte("first_seen_at", fromIso).lt("first_seen_at", toIso)
    .or(`source_id.is.null,source_id.not.in.(${RU_SOURCE_IDS.join(",")})`)
    .order("first_seen_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const ids = (refs ?? []).map((r) => String(r.id));
  const observations = new Map<string, Array<ObservationLite & { method: string }>>();
  if (ids.length > 0) {
    const data = await rowsByIds<ObservationLite & { method: string; reference_id: string }>(ids, "Наблюдения недели", (part, from, to) => db.from("assortment_observations")
      .select("reference_id,group_kind,metric,value_text,value_num,null_reason,status,method,observed_at")
      .in("reference_id", part)
      .order("reference_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Array<ObservationLite & { method: string; reference_id: string }> | null; error: { message: string } | null }>);
    for (const o of data) observations.set(o.reference_id, [...(observations.get(o.reference_id) ?? []), o]);
  }

  const directions: Record<AssortmentDirection, DigestDirection> = { bags: emptyDirection(), jackets: emptyDirection() };
  const findings: Record<AssortmentDirection, DigestFinding[]> = { bags: [], jackets: [] };
  for (const ref of refs ?? []) {
    const direction = ref.direction as AssortmentDirection;
    if (!directions[direction]) continue;
    // «Рынок РФ» (топ WB, Lime на WB) — замер рынка, а не находка недели: он каждую неделю вписывает в «новые» сотни позиций.
    if (isRuSource(ref.source_id ? String(ref.source_id) : null)) continue;
    const obs = observations.get(String(ref.id)) ?? [];
    // Отобранное из каталога — выбор человека, а не новинка: оно уже среди решений «отобрано».
    if (obs.some((o) => o.metric === "catalog_pick")) continue;
    const attributes = (ref.attributes ?? {}) as Attributes;
    const colors = Array.isArray(attributes.colors?.value) ? attributes.colors.value.length : 0;
    const manual = !ref.source_id || obs.some((o) => o.metric === "first_seen" && o.method === "import_manual");
    const signal = cardSignal(obs, { manual, colors });
    directions[direction].newCount += 1;
    if (signal.tone === "retail") directions[direction].retailCount += 1;
    findings[direction].push({ id: String(ref.id), title: String(ref.title ?? ""), brand: ref.brand ? String(ref.brand) : null, label: signal.label, tone: signal.tone });
  }
  for (const direction of ["bags", "jackets"] as const) directions[direction].top = topFindings(findings[direction]);

  const { data: decisions, error: decError } = await db.from("assortment_decisions")
    .select("reference_id,decision,reason")
    .not("reference_id", "is", null)
    .gte("created_at", fromIso).lt("created_at", toIso)
    .limit(2000);
  if (decError) throw new Error(decError.message);
  const decided = [...new Set((decisions ?? []).map((d) => String(d.reference_id)))];
  const directionOf = new Map<string, AssortmentDirection>();
  if (decided.length > 0) {
    const data = await rowsByIds<{ id: string; direction: string }>(decided, "Разделы решений недели", (part, from, to) => db.from("assortment_references")
      .select("id,direction")
      .in("id", part)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Array<{ id: string; direction: string }> | null; error: { message: string } | null }>);
    for (const r of data) directionOf.set(String(r.id), r.direction as AssortmentDirection);
  }
  const reasons: Record<AssortmentDirection, Map<LessonReason, number>> = { bags: new Map(), jackets: new Map() };
  for (const d of decisions ?? []) {
    const direction = directionOf.get(String(d.reference_id));
    if (!direction) continue;
    if (d.decision === "selected") directions[direction].selected += 1;
    if (d.decision === "sample_needed") directions[direction].sampleNeeded += 1;
    if (d.decision === "rejected") {
      directions[direction].rejected += 1;
      const key = reasonKey(d.reason ? String(d.reason) : null);
      if (key) reasons[direction].set(key, (reasons[direction].get(key) ?? 0) + 1);
    }
  }
  for (const direction of ["bags", "jackets"] as const) {
    const top = [...reasons[direction].entries()].sort((a, b) => b[1] - a[1])[0];
    directions[direction].topReason = top ? REASON_SHORT[top[0]] : null;
  }

  const collections = (await listCollections(db))
    .filter((c) => c.status !== "archived")
    .map((c) => ({ id: c.id, title: c.title, progress: c.progress.label, status: COLLECTION_STATUS_LABEL[c.status].toLowerCase(), version: c.version }));

  return { from: fromIso, to: toIso, directions, collections, crawl: await loadCrawlHealth(db, fromIso), history: await loadHistoryLine(db, to), baseUrl };
}

/**
 * Глубина истории наблюдений по источникам каталогов (без «Рынка РФ»): сводка прямо говорит, у каких «появилось/пропало»
 * уже наблюдение, а у каких история ещё копится. null — журнала прогонов нет или он пуст.
 */
async function loadHistoryLine(db: SupabaseClient, now: Date): Promise<DigestFacts["history"]> {
  const state = await loadHistoryState(db, now);
  if (!state.available) return null;
  const sources = state.sources.filter((s) => !isRuSource(s.sourceId));
  if (sources.length === 0) return null;
  const { data } = await db.from("assortment_sources").select("source_id,name");
  const nameOf = new Map((data ?? []).map((r) => [String(r.source_id), String(r.name ?? "")]));
  return sources.map((s) => ({ name: nameOf.get(s.sourceId) || s.sourceId, status: s.status, ...(s.partNames.length ? { parts: s.partNames.map(partLabel) } : {}) }));
}
