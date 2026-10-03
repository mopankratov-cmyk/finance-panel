import type { SupabaseClient } from "@supabase/supabase-js";
import { brandTopItems, hasMpstats, itemSubject, subjectTopItems, type MarketItem } from "@/lib/mpstats/client";
import { getWbCardImage } from "@/lib/wb/cardImage";
import { closedMoscowDates } from "@/lib/wb/sklejki";
import type { AssortmentDirection } from "./constants";
import { dedupKey } from "./extract";
import { remoteImage, storeImages } from "./importer";
import { closestRuMatch, isRuSource, shapeStems, LIME_BRANDS, RU_LIME_PER_DIRECTION, RU_SOURCE_IDS, RU_SOURCES, RU_TOP_PER_SUBJECT, ruDirection, wbProductUrl, type RuSimilarCandidate } from "./ruMarket";
import { formatValue, type Attributes } from "./attributes";
import { MAX_DISTANCE, similarityPercent } from "./similar";
import { ownSubjects } from "./wbDemand";

const NEW_PER_RUN = 120;

export interface RuMarketResult {
  sourceId: string;
  items: number;
  added: number;
  updated: number;
  error?: string;
}

/** Источники «Рынок РФ» в паспорте — заводим кодом, отдельной миграции не нужно. */
async function ensureSources(db: SupabaseClient) {
  const rows = Object.values(RU_SOURCES).map((s) => ({
    ...s,
    categories: ["jackets", "bags"],
    region: "Россия",
    priority: "P0",
    adapter_type: "MPSTATS",
    access_status: "auto_verified",
    research_status: "Рынок РФ",
  }));
  const { error } = await db.from("assortment_sources").upsert(rows, { onConflict: "source_id" });
  if (error) throw new Error(error.message);
}

async function mark(db: SupabaseClient, sourceId: string, ok: boolean, error: string | null) {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { last_attempt_at: now, last_error: error };
  if (ok) patch.last_success_at = now;
  await db.from("assortment_sources").update(patch).eq("source_id", sourceId);
}

async function storeItem(db: SupabaseClient, sourceId: string, direction: AssortmentDirection, item: MarketItem, method: string, withPhoto: boolean): Promise<"added" | "updated"> {
  const url = wbProductUrl(item.id);
  const key = dedupKey(sourceId, "RU", String(item.id), url);
  const now = new Date().toISOString();
  const { data: existing } = await db.from("assortment_references").select("id").eq("dedup_key", key).maybeSingle();
  let referenceId: string;
  let outcome: "added" | "updated";
  if (existing) {
    referenceId = String(existing.id);
    await db.from("assortment_references").update({ last_seen_at: now }).eq("id", referenceId);
    outcome = "updated";
  } else {
    const attributes: Record<string, unknown> = {};
    if (item.subject) attributes.category = { value: item.subject, origin: "published" };
    if (item.color) attributes.colors = { value: [item.color], origin: "published" };
    const { data: inserted, error } = await db.from("assortment_references").insert({
      direction,
      source_id: sourceId,
      region: "RU",
      source_item_id: String(item.id),
      url,
      dedup_key: key,
      article: String(item.id),
      title: item.name,
      brand: item.brand,
      attributes,
      created_by: "crawler",
    }).select("id").single();
    if (error || !inserted) throw new Error(error?.message ?? "находка не сохранилась");
    referenceId = String(inserted.id);
    outcome = "added";
    await db.from("assortment_observations").insert({ reference_id: referenceId, group_kind: "novelty", metric: "first_seen", value_text: now, method, status: "observed", source_url: url, observed_at: now, created_by: "crawler" });
    if (withPhoto) {
      const cover = await getWbCardImage(item.id).catch(() => null);
      const image = cover ? await remoteImage(cover) : null;
      if (image) await storeImages(db, referenceId, [image], false);
    }
  }
  // Еженедельный замер — из них складывается динамика продаж модели на WB.
  const base = { reference_id: referenceId, method, status: "provider_estimate", source_url: url, observed_at: now, created_by: "crawler", period: "30 дней" };
  const rows: Array<Record<string, unknown>> = [];
  if (item.sales != null) rows.push({ ...base, group_kind: "retail", metric: "wb_sales_30d", value_num: item.sales, unit: "шт" });
  if (item.comments != null) rows.push({ ...base, group_kind: "retail", metric: "reviews_count", value_num: item.comments, unit: "отзывов" });
  if (item.rating != null && item.comments) rows.push({ ...base, group_kind: "retail", metric: "rating", value_num: item.rating });
  if (rows.length) await db.from("assortment_observations").insert(rows);
  return outcome;
}

/**
 * Без продаж за месяц — не ориентир рынка: живая проверка 03.10 показала, что
 * «LIME» в MPSTATS — мелкий продавец с нулевыми продажами.
 */
export function sellingOnly<T extends { item: MarketItem }>(picks: T[]): T[] {
  return picks.filter((p) => typeof p.item.sales === "number" && p.item.sales > 0);
}

/** Позиции рынка, у которых последний замер — ноль продаж, прячем из вкладки. */
async function archiveNotSelling(db: SupabaseClient) {
  const { data: refs } = await db.from("assortment_references").select("id").in("source_id", RU_SOURCE_IDS).neq("status", "archived");
  const ids = (refs ?? []).map((r) => String(r.id));
  if (ids.length === 0) return 0;
  const sales = await latestSales(db, ids);
  const dead = ids.filter((id) => (sales.get(id) ?? 0) <= 0);
  if (dead.length) await db.from("assortment_references").update({ status: "archived", updated_at: new Date().toISOString() }).in("id", dead);
  return dead.length;
}

async function storeAll(db: SupabaseClient, sourceId: string, allPicks: Array<{ direction: AssortmentDirection; item: MarketItem }>, method: string, deadline: number, budget: { added: number }): Promise<RuMarketResult> {
  const picks = sellingOnly(allPicks);
  const result: RuMarketResult = { sourceId, items: picks.length, added: 0, updated: 0 };
  for (const { direction, item } of picks) {
    if (Date.now() > deadline) break;
    try {
      const outcome = await storeItem(db, sourceId, direction, item, method, budget.added < NEW_PER_RUN);
      if (outcome === "added") {
        result.added += 1;
        budget.added += 1;
      } else result.updated += 1;
    } catch {
      // одна позиция не легла — остальные идут
    }
  }
  return result;
}

/** Еженедельный замер рынка WB и Lime. */
export async function collectRuMarket(db: SupabaseClient, deadline: number): Promise<RuMarketResult[]> {
  if (!hasMpstats()) throw new Error("MPSTATS не подключён");
  await ensureSources(db);
  const dates = closedMoscowDates(30);
  const [d1, d2] = [dates[0], dates[dates.length - 1]];
  const budget = { added: 0 };
  const results: RuMarketResult[] = [];

  // Топ предметов своих товаров: сумки CLÉRIN, куртки NORVIA/HEATON.
  try {
    const { data, error } = await db.from("wb_cards").select("nm_id,brand,subject").not("subject", "is", null).limit(5000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ subject: string | null; nm_id: number; brand: string | null }>;
    const picks: Array<{ direction: AssortmentDirection; item: MarketItem }> = [];
    for (const direction of ["bags", "jackets"] as const) {
      for (const subject of ownSubjects(rows, direction)) {
        const resolved = await itemSubject(subject.nmId);
        if (!resolved) continue;
        const items = await subjectTopItems(resolved.id, d1, d2, RU_TOP_PER_SUBJECT);
        for (const item of items) picks.push({ direction: ruDirection(item.subject ?? resolved.name, item.name) ?? direction, item });
      }
    }
    results.push(await storeAll(db, RU_SOURCES.wb.source_id, picks, "mpstats_top", deadline, budget));
    await mark(db, RU_SOURCES.wb.source_id, true, null);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "ошибка";
    await mark(db, RU_SOURCES.wb.source_id, false, `MPSTATS: ${message}`);
    results.push({ sourceId: RU_SOURCES.wb.source_id, items: 0, added: 0, updated: 0, error: message });
  }

  // Lime на WB: самые продаваемые сумки и верхняя одежда бренда.
  try {
    let items: MarketItem[] = [];
    for (const brand of LIME_BRANDS) {
      items = await brandTopItems(brand, d1, d2, 200);
      if (items.length) break;
    }
    const picks: Array<{ direction: AssortmentDirection; item: MarketItem }> = [];
    for (const direction of ["bags", "jackets"] as const) {
      const own = items.filter((item) => ruDirection(item.subject, item.name) === direction && (item.sales ?? 0) > 0).slice(0, RU_LIME_PER_DIRECTION);
      picks.push(...own.map((item) => ({ direction, item })));
    }
    if (items.length === 0) throw new Error("бренд Lime в MPSTATS не найден");
    if (picks.length === 0) throw new Error("у Lime на WB нет продаж сумок и верхней одежды за 30 дней — похоже, официального магазина Lime на WB нет");
    results.push(await storeAll(db, RU_SOURCES.lime.source_id, picks, "mpstats_brand", deadline, budget));
    await mark(db, RU_SOURCES.lime.source_id, true, null);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "ошибка";
    await mark(db, RU_SOURCES.lime.source_id, false, `MPSTATS: ${message}`);
    results.push({ sourceId: RU_SOURCES.lime.source_id, items: 0, added: 0, updated: 0, error: message });
  }
  await archiveNotSelling(db);
  return results;
}

async function latestSales(db: SupabaseClient, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const { data } = await db.from("assortment_observations")
    .select("reference_id,value_num,observed_at")
    .eq("metric", "wb_sales_30d")
    .in("reference_id", ids)
    .order("observed_at", { ascending: false });
  for (const row of data ?? []) {
    const id = String(row.reference_id);
    if (!out.has(id) && typeof row.value_num === "number") out.set(id, row.value_num);
  }
  return out;
}

/**
 * Учимся у рынка: для каждой зарубежной находки — самое продаваемое похожее
 * по фото на WB. Пишется наблюдением ru_similar_sales (прошлое заменяется:
 * это вывод, а не замер).
 */
export async function learnFromRuMarket(db: SupabaseClient, deadline: number): Promise<{ checked: number; matched: number }> {
  const { data: embedded } = await db.from("assortment_media_embeddings").select("reference_id").not("embedding", "is", null).limit(5000);
  const ids = [...new Set((embedded ?? []).map((r) => String(r.reference_id)))];
  if (ids.length === 0) return { checked: 0, matched: 0 };
  const { data: refs } = await db.from("assortment_references").select("id,source_id,title,brand,url,direction,status,attributes").in("id", ids);
  const all = new Map((refs ?? []).map((r) => [String(r.id), r]));
  const foreign = (refs ?? []).filter((r) => !isRuSource(r.source_id) && r.status !== "archived");
  let matched = 0;
  let checked = 0;
  for (const ref of foreign) {
    if (Date.now() > deadline) break;
    checked += 1;
    const plain = Object.fromEntries(Object.entries((ref.attributes ?? {}) as Attributes).map(([k, v]) => [k, formatValue(v)]));
    const stems = shapeStems(ref.direction as AssortmentDirection, plain);
    if (stems.length === 0) {
      // Формы ещё нет (ИИ не разобрал фото) — сравнивать не с чем, сигнала нет.
      await db.from("assortment_observations").delete().eq("reference_id", ref.id).eq("metric", "ru_similar_sales");
      continue;
    }
    const { data: similar } = await db.rpc("assortment_similar_models", { p_reference_id: ref.id, p_limit: 30 });
    const ru = ((similar ?? []) as Array<{ reference_id: string; distance: number }>)
      .filter((s) => s.distance <= MAX_DISTANCE)
      .map((s) => ({ s, r: all.get(String(s.reference_id)) }))
      .filter((x) => x.r && isRuSource(x.r.source_id) && x.r.direction === ref.direction);
    const sales = await latestSales(db, ru.map((x) => String(x.r!.id)));
    const best = closestRuMatch(ru.map((x): RuSimilarCandidate => ({
      referenceId: String(x.r!.id), distance: x.s.distance, sales: sales.get(String(x.r!.id)) ?? null,
      title: String(x.r!.title ?? ""), brand: x.r!.brand ? String(x.r!.brand) : null, url: String(x.r!.url ?? ""),
    })), stems);
    await db.from("assortment_observations").delete().eq("reference_id", ref.id).eq("metric", "ru_similar_sales");
    if (!best) continue;
    matched += 1;
    const now = new Date().toISOString();
    await db.from("assortment_observations").insert({
      reference_id: ref.id, group_kind: "spread", metric: "ru_similar_sales", value_num: best.sales, unit: "шт", period: "30 дней",
      value_text: `${[best.brand, best.title].filter(Boolean).join(" · ").slice(0, 180)} (сходство по фото ${similarityPercent(best.distance)}%)`,
      method: "mpstats_similar", status: "provider_estimate", source_url: best.url, observed_at: now, created_by: "crawler",
    });
  }
  return { checked, matched };
}

export { RU_SOURCE_IDS };
