import type { SupabaseClient } from "@supabase/supabase-js";
import { BrightDataError, filterDataset, snapshotProgress, stripMoney, triggerCollection } from "./brightdata";
import {
  asCatalogItem, BRIGHTDATA_TARGETS, coverageKey, datasetVerdict, filterSignature, looksLikeChurn, mapRecord, novelCandidates, PENDING_TTL_MS, readCoverage, readPending,
  isDeadImageUrl, readPhotoPending, uniqueRecords, writeCoverage, writePending, writePhotoPending, ZARA_PHOTOS, zaraModelCode, zaraPhotoFilter, zaraPhotosByCode,
  type MappedRecord, type PendingSnapshot, type PhotoPending,
} from "./brightdataCatalog";
import type { AssortmentDirection } from "./constants";
import { classifyItem, crawlPlan } from "./crawl";
import { isMissingColumnError } from "./errors";
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
  /** Фото Zara из второго набора: сколько моделей каталога получили фото. */
  photos?: number;
  /** Что с выборками фото: номер и состояние (для ручной проверки). */
  detail?: string[];
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
  if (response.status === 400 && /not ready|building|in progress/i.test(text)) return null;
  // Под фильтр ничего не подошло — выборка пустая (и бесплатная): применять нечего.
  if (response.status === 400 && /empty|no (data|records)/i.test(text)) return [];
  if (!response.ok) throw new BrightDataError(`выборка ${snapshotId}: HTTP ${response.status} ${text.slice(0, 160)}`, response.status);
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
async function knownIds(db: SupabaseClient, sourceId: string, direction: AssortmentDirection): Promise<{ known: Set<string>; orphans: Map<string, string>; livePhotos: Set<string> }> {
  const known = new Set<string>();
  // Сироты: новинки прошлых сборов без находки (потолок за прогон, сбой записи).
  const orphans = new Map<string, string>();
  // У кого в базе уже есть живые фото (например, Zara — из второго набора): «фото нет» в записи их не стирает.
  const livePhotos = new Set<string>();
  let columns = "source_item_id,baseline,reference_id,first_seen_at,image_urls";
  for (let from = 0; ; from += 1000) {
    let { data, error } = await db.from("assortment_source_items")
      .select(columns)
      .eq("source_id", sourceId).eq("direction", direction)
      .order("source_item_id", { ascending: true })
      .range(from, from + 999);
    if (error && isMissingColumnError(error) && columns.endsWith(",image_urls")) {
      columns = "source_item_id,baseline,reference_id,first_seen_at";
      ({ data, error } = await db.from("assortment_source_items").select(columns).eq("source_id", sourceId).eq("direction", direction).order("source_item_id", { ascending: true }).range(from, from + 999));
    }
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as unknown as Array<{ source_item_id: string; baseline: boolean; reference_id: string | null; first_seen_at: string; image_urls?: unknown }>) {
      const id = String(row.source_item_id);
      known.add(id);
      if (row.baseline === false && !row.reference_id && typeof row.first_seen_at === "string") orphans.set(id, row.first_seen_at);
      if (Array.isArray(row.image_urls) && row.image_urls.some((u) => typeof u === "string" && !isDeadImageUrl(u))) livePhotos.add(id);
    }
    if (!data || data.length < 1000) return { known, orphans, livePhotos };
  }
}

/**
 * Находка из записи обхода — без чтения страницы магазина (она закрыта для нас
 * или запрещена robots.txt). Общая для новинок обходов и отбора из каталога.
 */
export async function createFromRecord(
  db: SupabaseClient,
  source: { sourceId: string; name: string },
  direction: AssortmentDirection,
  record: MappedRecord,
  method: string,
  deadline: number,
  options: {
    /**
     * Когда обход впервые увидел модель — в наблюдение «впервые замечено». Дата
     * самой находки — сегодняшняя: иначе застрявшая новинка не попала бы ни в
     * воскресную сводку, ни в верх ленты.
     */
    firstSeenAt?: string;
    /** false — фото облаку не отдадут (сайт через mini): не тратим время, их принесёт mini. */
    cloudPhotos?: boolean;
    /** catalog_pick — человек отобрал модель из каталога бренда: это не новинка, а выбор. */
    origin?: "novelty" | "catalog_pick";
  } = {},
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
    options.origin === "catalog_pick"
      ? { ...base, group_kind: "novelty", metric: "catalog_pick", value_text: options.firstSeenAt ?? now, status: "observed" }
      : { ...base, group_kind: "novelty", metric: "first_seen", value_text: options.firstSeenAt ?? now, status: "observed" },
  ];
  if (record.reviews != null) observations.push({ ...base, group_kind: "retail", metric: "reviews_count", value_num: record.reviews, unit: "отзывов", status: "observed" });
  if (record.rating != null && record.reviews) observations.push({ ...base, group_kind: "retail", metric: "rating", value_num: record.rating, status: "observed" });
  await db.from("assortment_observations").insert(observations);

  const images: ImageBytes[] = [];
  for (const url of options.cloudPhotos === false ? [] : record.images) {
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
  return ingestRecords(db, source, snapshot, records, deadline, { quiet, churnGuard, drainOrphans: snapshot.kind === "dataset", imagesKnown: snapshot.kind === "dataset" });
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
    /** false — сайт не пускает облако (магазины через mini): фото принесёт mini. */
    cloudPhotos?: boolean;
    /** Записи полные (готовый набор): нет фото — снимаем старые ссылки. */
    imagesKnown?: boolean;
    /**
     * Разбирать застрявшие новинки прошлых сборов — только где раздел берётся
     * целиком (готовые наборы, сайты РФ). Выдача поиска ASOS и раздела H&M сама
     * обрезана: «невиданное» там — не обязательно новое, хвост не разбираем.
     */
    drainOrphans?: boolean;
  } = {},
): Promise<IngestResult> {
  const quiet = Boolean(options.quiet);
  const churnGuard = Boolean(options.churnGuard);
  const records = uniqueRecords(mapped);
  const relevant = records.filter((r) => classifyItem(asCatalogItem(r), [target.direction]) === target.direction);
  const { known, orphans, livePhotos } = await knownIds(db, source.sourceId, target.direction);
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
      // «Фото нет» в полной записи набора снимает только мёртвые ссылки — живые (из второго набора Zara) не трогаем.
      ...catalogFields({ images: r.images, imagesKnown: options.imagesKnown && !livePhotos.has(r.sourceItemId), brand: r.brand ?? source.name }),
    };
    if (plan.baseline || !known.has(r.sourceItemId)) inserts.push({ ...row, baseline: asBaseline || !fresh.has(r.sourceItemId) });
    else updates.push(row);
  }
  await upsertSourceItems(db, inserts, { fresh: true });
  await upsertSourceItems(db, updates);
  let added = 0;
  const missingPhotos: IngestResult["missingPhotos"] = [];
  // Первая база — находок нет. Иначе сначала застрявшие новинки прошлых сборов
  // (даже если этот сбор лёг базой), затем свежие — если сбору верим.
  if (!plan.baseline) {
    const byId = new Map(relevant.map((r) => [r.sourceItemId, r]));
    const { create, expire } = novelCandidates(relevant.map((r) => r.sourceItemId), fresh, options.drainOrphans ? orphans : new Map(), Date.now(), asBaseline);
    if (expire.length) {
      for (let i = 0; i < expire.length; i += 200) {
        await db.from("assortment_source_items").update({ baseline: true }).eq("source_id", source.sourceId).in("source_item_id", expire.slice(i, i + 200));
      }
    }
    for (const id of create) {
      const r = byId.get(id);
      if (!r) continue;
      if (added >= NEW_PER_SOURCE || Date.now() > deadline) break;
      try {
        const created = await createFromRecord(db, source, target.direction, r, target.method, deadline, { firstSeenAt: orphans.get(id), cloudPhotos: options.cloudPhotos });
        await db.from("assortment_source_items").update({ reference_id: created.referenceId }).eq("source_id", source.sourceId).eq("source_item_id", r.sourceItemId);
        if (created.created) added += 1;
        if (created.created && created.photos === 0 && r.images.length > 0) missingPhotos.push({ referenceId: created.referenceId, urls: r.images });
      } catch {
        // одна запись не легла — остальные идут; эта останется сиротой и пойдёт первой в следующий сбор
      }
    }
  }
  return { collected: relevant.length, added, baseline: asBaseline, churn, missingPhotos };
}

const ZARA_ROW_COLUMNS = "source_item_id,handle,reference_id,image_urls";

/**
 * Модели Zara в каталоге без живых фото (за 30 дней): фото нет вовсе или все
 * ссылки — удалённые Zara снимки старого вида (их база хранит до следующего сбора).
 */
async function zaraRowsWithoutPhotos(db: SupabaseClient): Promise<Array<{ source_item_id: string; handle: string | null; reference_id: string | null }>> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  // Устойчивый порядок: модели за пределами 400 за выборку получат фото в следующие недели.
  const { data, error } = await db.from("assortment_source_items").select(ZARA_ROW_COLUMNS)
    .eq("source_id", ZARA_PHOTOS.sourceId).not("direction", "is", null).gte("last_seen_at", since)
    .order("source_item_id", { ascending: true })
    .limit(1000);
  if (error) {
    if (isMissingColumnError(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Array<{ source_item_id: string; handle: string | null; reference_id: string | null; image_urls: unknown }>)
    .filter((r) => !Array.isArray(r.image_urls) || r.image_urls.every((u) => typeof u !== "string" || isDeadImageUrl(u)));
}

/** Выборка фото Zara из «Zara.com products» по моделям без фото; null — просить нечего. */
export async function triggerZaraPhotos(db: SupabaseClient): Promise<PhotoPending | null> {
  const codes = [...new Set((await zaraRowsWithoutPhotos(db)).map((r) => zaraModelCode(r.handle)).filter((c): c is string => Boolean(c)))];
  if (codes.length === 0) return null;
  const snapshotId = await filterDataset(ZARA_PHOTOS.datasetId, zaraPhotoFilter(codes), ZARA_PHOTOS.recordsLimit);
  return { snapshotId, triggeredAt: new Date().toISOString() };
}

/** Фото из выборки — в строки каталога Zara; находкам Zara без снимков — скачать (CDN Zara облако пускает). */
async function applyZaraPhotos(db: SupabaseClient, records: unknown[], deadline: number): Promise<number> {
  const byCode = zaraPhotosByCode(records);
  if (byCode.size === 0) return 0;
  const rows = await zaraRowsWithoutPhotos(db);
  const updates: Array<Record<string, unknown>> = [];
  const refs: Array<{ id: string; urls: string[] }> = [];
  for (const row of rows) {
    const urls = byCode.get(zaraModelCode(row.handle) ?? "");
    if (!urls) continue;
    updates.push({ source_id: ZARA_PHOTOS.sourceId, source_item_id: row.source_item_id, image_urls: urls });
    if (row.reference_id) refs.push({ id: row.reference_id, urls });
  }
  await upsertSourceItems(db, updates);
  // Сначала — какие находки действительно без фото, потом потолок 20 скачиваний.
  const withMedia = new Set<string>();
  for (let i = 0; i < refs.length; i += 200) {
    const { data: media, error: mediaError } = await db.from("assortment_media").select("reference_id").in("reference_id", refs.slice(i, i + 200).map((r) => r.id));
    if (mediaError) throw new Error(mediaError.message);
    for (const m of media ?? []) withMedia.add(String(m.reference_id));
  }
  for (const ref of refs.filter((r) => !withMedia.has(r.id)).slice(0, 20)) {
    if (Date.now() > deadline) break;
    const images: ImageBytes[] = [];
    for (const url of ref.urls.slice(0, 2)) {
      const image = await remoteImage(url);
      if (image) images.push(image);
    }
    if (images.length) await storeImages(db, ref.id, images, false);
  }
  return updates.length;
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
      // Фото Zara: применить готовую выборку; после свежего сбора Zara — заказать фото тем, у кого их нет.
      let photoLeft: PhotoPending[] = [];
      if (sourceId === ZARA_PHOTOS.sourceId) {
        for (const pending of readPhotoPending(source.capabilities)) {
          const rows = Date.now() > deadline ? null : await downloadDatasetRecords(pending.snapshotId).catch((e) => { errors.push(`фото Zara: ${String(e?.message ?? e).slice(0, 120)}`); return undefined; });
          if (rows === undefined) continue;
          if (rows === null) {
            if (Date.now() - Date.parse(pending.triggeredAt) < PENDING_TTL_MS) photoLeft.push(pending);
            continue;
          }
          try {
            result.photos = (result.photos ?? 0) + await applyZaraPhotos(db, rows, deadline);
          } catch (e) {
            // Оплаченная выборка не пропадает: остаётся в очереди, ошибка — в «Источниках».
            errors.push(`фото Zara: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
            photoLeft.push(pending);
          }
        }
        if ((result.collected ?? 0) > 0 && photoLeft.length === 0) {
          const next = await triggerZaraPhotos(db).catch((e) => { errors.push(`фото Zara: ${String(e?.message ?? e).slice(0, 120)}`); return null; });
          if (next) photoLeft = [next];
        }
      }
      result.pending = left.length + photoLeft.length;
      const caps = writeCoverage(writePending(source.capabilities, left), coverage);
      const patch: Record<string, unknown> = { capabilities: sourceId === ZARA_PHOTOS.sourceId ? writePhotoPending(caps, photoLeft) : caps, last_attempt_at: now, last_error: errors.length ? `Bright Data: ${errors.join("; ")}` : null };
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

/**
 * Ручной запуск фото Zara (?phase=photos): готовую выборку — применить сразу;
 * неготовую свежую — ждать; новую заказать, только если до вызова ничего не
 * ждало (не покупаем выборку на каждый вызов).
 */
export async function requestZaraPhotos(db: SupabaseClient, deadline: number): Promise<BrightDataRunResult> {
  const source = await readSource(db, ZARA_PHOTOS.sourceId);
  const caps = (source.capabilities && typeof source.capabilities === "object" ? source.capabilities : {}) as Record<string, unknown>;
  const result: BrightDataRunResult = { sourceId: ZARA_PHOTOS.sourceId, phase: "trigger", ok: true, triggered: 0, photos: 0 };
  const left: PhotoPending[] = [];
  const waiting = readPhotoPending(caps);
  const fresh = (p: PhotoPending) => Date.now() - Date.parse(p.triggeredAt) < PENDING_TTL_MS;
  result.detail = [];
  for (const pending of waiting) {
    let rows: unknown[] | null;
    try {
      rows = await downloadDatasetRecords(pending.snapshotId);
    } catch (e) {
      // Выборка не удалась у Bright Data — снимаем (иначе висела бы вечно и не давала заказать новую); сбой связи — ждём до суток.
      const message = String((e as Error)?.message ?? e).slice(0, 200);
      const failed = e instanceof BrightDataError && e.status !== undefined && e.status < 500;
      if (!failed && fresh(pending)) left.push(pending);
      result.detail.push(`${pending.snapshotId}: ${failed ? "снята" : "ждём"} — ${message}`);
      continue;
    }
    if (rows === null) {
      if (fresh(pending)) left.push(pending);
      result.detail.push(`${pending.snapshotId}: ещё собирается${fresh(pending) ? "" : " больше суток — снята"}`);
      continue;
    }
    const applied = await applyZaraPhotos(db, rows, deadline);
    result.photos = (result.photos ?? 0) + applied;
    result.detail.push(`${pending.snapshotId}: записей ${rows.length}, фото получили ${applied}`);
  }
  // Новую выборку — только если ничего не ждало: применили готовую — на этом всё (повторный вызов не покупает ещё одну).
  if (waiting.length === 0) {
    const next = await triggerZaraPhotos(db);
    if (next) {
      left.push(next);
      result.triggered = 1;
    }
  }
  result.pending = left.length;
  await mark(db, ZARA_PHOTOS.sourceId, { capabilities: writePhotoPending(caps, left) });
  return result;
}
