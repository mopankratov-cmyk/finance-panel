import type { SupabaseClient } from "@supabase/supabase-js";
import { BrightDataError, filterDataset, snapshotProgress, stripMoney, triggerCollection } from "./brightdata";
import {
  asCatalogItem, BRIGHTDATA_TARGETS, coverageKey, datasetVerdict, filterSignature, looksLikeChurn, mapRecord, PENDING_TTL_MS, readCoverage, readPending,
  uniqueRecords, writeCoverage, writePending, type MappedRecord, type PendingSnapshot,
} from "./brightdataCatalog";
import type { AssortmentDirection } from "./constants";
import { classifyItem, crawlPlan } from "./crawl";
import { dedupKey, normalizeProductUrl, regionFromUrl } from "./extract";
import { remoteImage, storeImages, type ImageBytes } from "./importer";
import { catalogFields, upsertSourceItems } from "./sourceItems";

/** Новых находок на источник за один сбор: остальное — очередь до следующего. */
const NEW_PER_SOURCE = 15;
const API = "https://api.brightdata.com";

export interface BrightDataRunResult {
  sourceId: string;
  phase: "trigger" | "collect";
  ok: boolean;
  triggered?: number;
  collected?: number;
  added?: number;
  baseline?: boolean;
  pending?: number;
  error?: string;
}

async function readSource(db: SupabaseClient, sourceId: string) {
  const { data, error } = await db.from("assortment_sources").select("source_id,name,capabilities").eq("source_id", sourceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Источник ${sourceId} не найден в паспорте`);
  return data as { source_id: string; name: string; capabilities: unknown };
}

async function mark(db: SupabaseClient, sourceId: string, patch: Record<string, unknown>) {
  const { error } = await db.from("assortment_sources").update(patch).eq("source_id", sourceId);
  if (error) throw new Error(error.message);
}

/** Запуск проб по всем целям (ср и сб утром). Номера проб — в capabilities источника. */
export async function triggerBrightData(db: SupabaseClient, options: { only?: string | null; force?: boolean } = {}): Promise<BrightDataRunResult[]> {
  const bySource = new Map<string, typeof BRIGHTDATA_TARGETS>();
  for (const target of BRIGHTDATA_TARGETS) {
    if (options.only && target.sourceId !== options.only) continue;
    bySource.set(target.sourceId, [...(bySource.get(target.sourceId) ?? []), target]);
  }
  const results: BrightDataRunResult[] = [];
  for (const [sourceId, targets] of bySource) {
    const now = new Date().toISOString();
    try {
      const source = await readSource(db, sourceId);
      const pending = readPending(source.capabilities).filter((p) => Date.now() - Date.parse(p.triggeredAt) < PENDING_TTL_MS);
      let started = 0;
      for (const target of targets) {
        if (!options.force && target.weekdayUtc !== undefined && new Date().getUTCDay() !== target.weekdayUtc) continue;
        const snapshotId = target.kind === "dataset"
          ? await filterDataset(target.datasetId, target.filter, target.recordsLimit ?? 50)
          : await triggerCollection({ datasetId: target.datasetId, discoverBy: target.discoverBy, inputs: target.inputs, limitPerInput: target.limitPerInput });
        pending.push({
          snapshotId, datasetId: target.datasetId, direction: target.direction, method: target.method, triggeredAt: now, kind: target.kind,
          ...(target.kind === "dataset" ? { recordsLimit: target.recordsLimit ?? 50, coverage: filterSignature(target.filter) } : {}),
        });
        started += 1;
      }
      if (started === 0) continue;
      await mark(db, sourceId, { capabilities: writePending(source.capabilities, pending), last_attempt_at: now, last_error: null });
      results.push({ sourceId, phase: "trigger", ok: true, triggered: started, pending: pending.length });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "ошибка запуска";
      await mark(db, sourceId, { last_attempt_at: now, last_error: `Bright Data: ${message}` }).catch(() => undefined);
      results.push({ sourceId, phase: "trigger", ok: false, error: message });
    }
  }
  return results;
}

/** Выборка готового набора: null — ещё собирается (Bright Data отвечает 202 или 400 «not ready»). */
async function downloadDatasetRecords(snapshotId: string): Promise<unknown[] | null> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) throw new BrightDataError("Ключ Bright Data не задан");
  const response = await fetch(`${API}/datasets/snapshots/${snapshotId}/download?format=json`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  if (response.status === 202) return null;
  const text = await response.text();
  if (response.status === 400 && /not ready/i.test(text)) return null;
  if (!response.ok) throw new BrightDataError(`выборка ${snapshotId}: HTTP ${response.status}`, response.status);
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data.map(stripMoney) : [];
  } catch {
    return [];
  }
}

async function downloadRecords(snapshotId: string): Promise<unknown[]> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) throw new BrightDataError("Ключ Bright Data не задан");
  const response = await fetch(`${API}/datasets/v3/snapshot/${snapshotId}?format=json`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  if (!response.ok) throw new BrightDataError(`снимок ${snapshotId}: HTTP ${response.status}`, response.status);
  const data = await response.json().catch(() => []);
  return Array.isArray(data) ? data.map(stripMoney) : [];
}

/**
 * Уже виденные вещи источника В ЭТОМ РАЗДЕЛЕ. База — по разделу, а не по
 * источнику: первый сбор 02.10 положил сумки ASOS базой, а куртки, разобранные
 * следом, посчитал новинками — 7 штук ушли в ленту.
 */
async function knownIds(db: SupabaseClient, sourceId: string, direction: AssortmentDirection): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("assortment_source_items").select("source_item_id").eq("source_id", sourceId).eq("direction", direction).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) ids.add(String(row.source_item_id));
    if (!data || data.length < 1000) return ids;
  }
}

/** Находка из записи Bright Data — без чтения страницы магазина (она закрыта для нас). */
async function createFromRecord(
  db: SupabaseClient,
  source: { sourceId: string; name: string },
  direction: AssortmentDirection,
  record: MappedRecord,
  method: string,
  deadline: number,
): Promise<{ referenceId: string; created: boolean; photos: number }> {
  const normalized = normalizeProductUrl(record.url);
  const region = regionFromUrl(record.url);
  const key = dedupKey(source.sourceId, region, record.sourceItemId, normalized);
  const now = new Date().toISOString();
  const { data: existing } = await db.from("assortment_references").select("id").eq("dedup_key", key).maybeSingle();
  if (existing) {
    await db.from("assortment_references").update({ last_seen_at: now }).eq("id", existing.id);
    return { referenceId: String(existing.id), created: false, photos: 0 };
  }
  const attributes: Record<string, unknown> = {};
  if (record.category) attributes.category = { value: record.category, origin: "published" };
  if (record.color) attributes.colors = { value: [record.color], origin: "published" };
  const { data: inserted, error } = await db.from("assortment_references").insert({
    direction,
    source_id: source.sourceId,
    region,
    source_item_id: record.sourceItemId,
    url: normalized,
    dedup_key: key,
    title: record.title,
    brand: record.brand ?? source.name,
    attributes,
    created_by: "crawler",
  }).select("id").single();
  if (error || !inserted) throw new Error(error?.message ?? "находка не сохранилась");
  const referenceId = String(inserted.id);
  const base = { reference_id: referenceId, method, source_url: record.url, observed_at: now, created_by: "crawler" };
  const observations: Array<Record<string, unknown>> = [
    { ...base, group_kind: "novelty", metric: "first_seen", value_text: now, status: "observed" },
  ];
  if (record.reviews != null) observations.push({ ...base, group_kind: "retail", metric: "reviews_count", value_num: record.reviews, unit: "отзывов", status: "observed" });
  if (record.rating != null && record.reviews) observations.push({ ...base, group_kind: "retail", metric: "rating", value_num: record.rating, status: "observed" });
  await db.from("assortment_observations").insert(observations);

  const images: ImageBytes[] = [];
  for (const url of record.images) {
    if (Date.now() > deadline) break;
    const image = await remoteImage(url);
    if (image) images.push(image);
  }
  const photos = await storeImages(db, referenceId, images, false);
  return { referenceId, created: true, photos };
}

async function processSnapshot(
  db: SupabaseClient,
  source: { sourceId: string; name: string },
  snapshot: PendingSnapshot,
  deadline: number,
  preloaded?: unknown[],
  /** Новинкам выборки не верим (раздел обрезан или сменил охват) — всё новое ложится базой. */
  quiet = false,
  /** Готовый набор: слишком много новинок разом — пересборка набора, а не новинки. */
  churnGuard = false,
): Promise<IngestResult> {
  const records = (preloaded ?? await downloadRecords(snapshot.snapshotId)).map(mapRecord).filter((r): r is MappedRecord => Boolean(r));
  return ingestRecords(db, source, snapshot, records, deadline, { quiet, churnGuard });
}

export interface IngestResult {
  collected: number;
  added: number;
  baseline: boolean;
  churn: boolean;
  /** Новые находки, чьи фото панель скачать не смогла (сайт не пускает облако) — их принесёт mini. */
  missingPhotos: Array<{ referenceId: string; urls: string[] }>;
}

/**
 * Записи раздела источника → база сравнения и новинки в ленту. Общий путь для
 * Bright Data и обхода каталогов сайтов (Lime): раздел проверяется по
 * названию, новинка — невиданная раньше модель, первый сбор — база.
 */
export async function ingestRecords(
  db: SupabaseClient,
  source: { sourceId: string; name: string },
  target: { direction: AssortmentDirection; method: string },
  mapped: MappedRecord[],
  deadline: number,
  options: {
    quiet?: boolean;
    churnGuard?: boolean;
    /** Кто вообще может быть новинкой (Lime — новые по карте сайта); остальное невиданное ложится базой. */
    freshOnly?: Set<string>;
  } = {},
): Promise<IngestResult> {
  const quiet = Boolean(options.quiet);
  const churnGuard = Boolean(options.churnGuard);
  const records = uniqueRecords(mapped);
  const relevant = records.filter((r) => classifyItem(asCatalogItem(r), [target.direction]) === target.direction);
  const known = await knownIds(db, source.sourceId, target.direction);
  const plan = crawlPlan(known, relevant.map(asCatalogItem));
  const fresh = new Set(plan.fresh.map((i) => i.sourceItemId).filter((id) => !options.freshOnly || options.freshOnly.has(id)));
  const churn = churnGuard && !plan.baseline && !quiet && looksLikeChurn(fresh.size, relevant.length);
  const asBaseline = plan.baseline || quiet || churn;
  const now = new Date().toISOString();
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  for (const r of relevant) {
    const row = {
      source_id: source.sourceId, source_item_id: r.sourceItemId, handle: r.url, title: r.title, product_type: r.category, direction: target.direction, last_seen_at: now,
      ...catalogFields({ images: r.images, brand: r.brand ?? source.name }),
    };
    if (plan.baseline || !known.has(r.sourceItemId)) inserts.push({ ...row, baseline: asBaseline || !fresh.has(r.sourceItemId) });
    else updates.push(row);
  }
  await upsertSourceItems(db, inserts, { fresh: true });
  await upsertSourceItems(db, updates);
  let added = 0;
  const missingPhotos: IngestResult["missingPhotos"] = [];
  if (!asBaseline) {
    for (const r of relevant.filter((x) => fresh.has(x.sourceItemId))) {
      if (added >= NEW_PER_SOURCE || Date.now() > deadline) break;
      try {
        const created = await createFromRecord(db, source, target.direction, r, target.method, deadline);
        await db.from("assortment_source_items").update({ reference_id: created.referenceId }).eq("source_id", source.sourceId).eq("source_item_id", r.sourceItemId);
        if (created.created) added += 1;
        if (created.created && created.photos === 0 && r.images.length > 0) missingPhotos.push({ referenceId: created.referenceId, urls: r.images });
      } catch {
        // одна запись не легла — остальные идут; эта останется в очереди без reference_id
      }
    }
  }
  return { collected: relevant.length, added, baseline: asBaseline, churn, missingPhotos };
}

/** Сбор готовых проб. Не готова — ждёт следующего захода; старше суток — снимается. */
export async function collectBrightData(db: SupabaseClient, deadline: number): Promise<BrightDataRunResult[]> {
  const sourceIds = [...new Set(BRIGHTDATA_TARGETS.map((t) => t.sourceId))];
  const results: BrightDataRunResult[] = [];
  for (const sourceId of sourceIds) {
    const now = new Date().toISOString();
    const result: BrightDataRunResult = { sourceId, phase: "collect", ok: true, collected: 0, added: 0 };
    try {
      const source = await readSource(db, sourceId);
      const left: PendingSnapshot[] = [];
      const errors: string[] = [];
      const coverage = readCoverage(source.capabilities);
      for (const snapshot of readPending(source.capabilities)) {
        if (Date.now() > deadline) {
          left.push(snapshot);
          continue;
        }
        if (snapshot.kind === "dataset") {
          const rows = await downloadDatasetRecords(snapshot.snapshotId).catch((e) => { errors.push(String(e?.message ?? e).slice(0, 160)); return undefined; });
          if (rows === undefined) continue;
          if (rows === null) {
            if (Date.now() - Date.parse(snapshot.triggeredAt) < PENDING_TTL_MS) left.push(snapshot);
            else errors.push(`выборка ${snapshot.snapshotId} не готова за сутки`);
            continue;
          }
          const verdict = datasetVerdict(rows.length, snapshot, coverage[coverageKey(snapshot)]);
          const done = await processSnapshot(db, { sourceId, name: source.name }, snapshot, deadline, rows, verdict.quiet, true);
          if (verdict.remember && snapshot.coverage) coverage[coverageKey(snapshot)] = snapshot.coverage;
          if (verdict.warning) errors.push(verdict.warning);
          if (done.churn) errors.push(`раздел «${snapshot.direction === "bags" ? "сумки" : "куртки"}»: ${done.collected} моделей, из них слишком много новых разом — похоже на пересборку набора, сбор лёг базой`);
          result.collected = (result.collected ?? 0) + done.collected;
          result.added = (result.added ?? 0) + done.added;
          result.baseline = result.baseline || done.baseline;
          continue;
        }
        const progress = await snapshotProgress(snapshot.snapshotId).catch((e) => ({ status: "error", error: String(e?.message ?? e) }));
        if (progress.status === "ready") {
          const done = await processSnapshot(db, { sourceId, name: source.name }, snapshot, deadline);
          result.collected = (result.collected ?? 0) + done.collected;
          result.added = (result.added ?? 0) + done.added;
          result.baseline = result.baseline || done.baseline;
        } else if (progress.status === "failed") {
          errors.push(`проба ${snapshot.snapshotId} не удалась у Bright Data`);
        } else if (Date.now() - Date.parse(snapshot.triggeredAt) < PENDING_TTL_MS) {
          left.push(snapshot);
        } else {
          errors.push(`проба ${snapshot.snapshotId} не готова за сутки`);
        }
      }
      result.pending = left.length;
      const patch: Record<string, unknown> = { capabilities: writeCoverage(writePending(source.capabilities, left), coverage), last_attempt_at: now, last_error: errors.length ? `Bright Data: ${errors.join("; ")}` : null };
      if ((result.collected ?? 0) > 0) patch.last_success_at = now;
      await mark(db, sourceId, patch);
      if (errors.length) {
        result.ok = false;
        result.error = errors.join("; ");
      }
    } catch (error) {
      result.ok = false;
      result.error = error instanceof Error ? error.message.slice(0, 200) : "ошибка сбора";
      await mark(db, sourceId, { last_attempt_at: now, last_error: `Bright Data: ${result.error}` }).catch(() => undefined);
    }
    results.push(result);
  }
  return results;
}
