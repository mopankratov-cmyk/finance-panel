import type { SupabaseClient } from "@supabase/supabase-js";
import { BrightDataError, filterDataset, isBrightDataBilling, snapshotProgress, stripMoney, triggerCollection } from "./brightdata";
import {
  asCatalogItem, boughtRecently, BRIGHTDATA_TARGETS, coverageKey, datasetVerdict, filterSignature, looksLikeChurn, mapRecord, novelCandidates, partRecords, pendingAlive, purchaseKey,
  readBought, readCoverage, readPending, readTriggerFailure, sectionLabel, targetSignature, triggerFailureNote, writeBought, writeTriggerFailure,
  isDeadImageUrl, readPhotoPending, uniqueRecords, writeCoverage, writePending, writePhotoPending, ZARA_PHOTOS, zaraModelCode, zaraPhotoFilter, zaraPhotosByCode,
  type MappedRecord, type PendingSnapshot, type PhotoPending,
} from "./brightdataCatalog";
import type { AssortmentDirection } from "./constants";
import {
  addToWeek, brightdataUsd, catalogWeeklyNeedUsd, engineBudgetConfig, engineRefusal, pendingMaxUsd, targetKind, targetMaxUsd, ZARA_PHOTOS_KIND, ZARA_PHOTOS_MAX_USD,
  type EngineBudgetConfig, type EngineWeek,
} from "./engineBudget";
import { addEngineUsage, loadEngineWeek } from "./engineBudgetStore";
import { classifyItem, crawlPlan } from "./crawl";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { isMissingColumnError } from "./errors";
import { dedupKey, normalizeProductUrl, regionFromUrl } from "./extract";
import { remoteImage, storeImages, type ImageBytes } from "./importer";
import { modelKey, newModelsOnly } from "./modelKey";
import { recordObservation, type RunCoverage, type SnapshotItem } from "./observationLog";
import { catalogFields, clearDirection, loadKnownModelKeys, upsertSourceItems } from "./sourceItems";

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
  /** Остановка «нет денег» (402, «Customer is not active»): оплаченные выборки ждут в очереди; сторож задач шлёт одну тревогу. */
  billing?: boolean;
  /** Сколько целей не куплено по общему потолку движка. */
  refusedByBudget?: number;
  /** Оценка расхода, записанного в учёт этим сбором, $. */
  spentUsd?: number;
  /** Расход не записался в учёт (выборки при этом не теряются). */
  usageError?: string;
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

/**
 * Окончательный отказ Bright Data по выборке (4xx, кроме 408 и 429): повторять бессмысленно, пробу снимаем. Сбой связи, таймаут,
 * 5xx и 429 — временные: оплаченная выборка остаётся в очереди до суток, а не выбрасывается после первого же сбоя скачивания.
 * То же правило — для отказа в самой покупке (фильтр не принят): денег не взято, следующая цель покупается.
 * «Нет денег» (402, «Customer is not active») проверяется раньше (isBrightDataBilling): прогон останавливается одной причиной, выборки ждут.
 */
function isPermanentDownloadError(error: unknown): boolean {
  const status = error instanceof BrightDataError ? error.status : undefined;
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** Причина остановки «нет денег» одной строкой — одинаково в «Источниках», журнале и тревоге. */
function billingReason(error: unknown): string {
  const detail = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 160) : "";
  return `нет денег или аккаунт не активен (402)${detail ? `: ${detail}` : ""}`;
}

/** Оплаченная выборка, которую не дал забрать «нет денег»: ждёт пополнения до двух недель (pendingAlive), а не сутки. */
const hold = <T extends { billingHeldAt?: string }>(p: T, at: string): T => (p.billingHeldAt ? p : { ...p, billingHeldAt: at });

/**
 * Сколько оплачено и ещё не записано в учёт: пробы в очереди источника (их расход запишет сбор) — оценкой сверху. Платный запуск
 * прибавляет их к неделе, иначе второй запуск в тот же день видел бы потолок свободным.
 */
function inFlight(week: EngineWeek, capabilities: unknown, sourceId: string, nowMs: number): EngineWeek {
  let next = week;
  for (const p of readPending(capabilities).filter((x) => pendingAlive(x, nowMs))) next = addToWeek(next, targetKind(p) ?? "brightdata:other", pendingMaxUsd(p));
  if (sourceId === ZARA_PHOTOS.sourceId) {
    for (const p of readPhotoPending(capabilities).filter((x) => pendingAlive(x, nowMs))) next = addToWeek(next, ZARA_PHOTOS_KIND, ZARA_PHOTOS_MAX_USD);
  }
  return next;
}

export interface TriggerOptions {
  only?: string | null;
  force?: boolean;
  /** Только для тестов: день недели и сутки отметок покупок. */
  now?: Date;
  /** Общий потолок движка (по умолчанию — из окружения). */
  engine?: EngineBudgetConfig;
}

/**
 * Запуск проб по всем целям (ср и сб утром). Номера проб — в capabilities источника.
 *
 * Перед каждой покупкой — общий потолок движка (ASSORTMENT_ENGINE_WEEKLY_BUDGET_USD): оценка запуска сверху (потолок записей × цена
 * метода) должна поместиться в остаток статьи с учётом резерва под каталоги выше по приоритету. Не поместилась — цель не покупается и
 * названа в «Источниках», остальные идут. Учёт не прочитался — не покупаем вслепую; таблицы учёта нет — прежнее правило без потолка.
 * «Нет денег» (402) — стоп всего запуска одной причиной: оплаченные пробы уже записаны, остальным источникам дня — та же причина.
 */
export async function triggerBrightData(db: SupabaseClient, options: TriggerOptions = {}): Promise<BrightDataRunResult[]> {
  const nowMs = options.now?.getTime() ?? Date.now();
  const engine = options.engine ?? engineBudgetConfig();
  const need = catalogWeeklyNeedUsd();
  const isDue = (target: (typeof BRIGHTDATA_TARGETS)[number]) => options.force || target.weekdayUtc === undefined || new Date(nowMs).getUTCDay() === target.weekdayUtc;
  const bySource = new Map<string, typeof BRIGHTDATA_TARGETS>();
  for (const target of BRIGHTDATA_TARGETS) {
    if (options.only && target.sourceId !== options.only) continue;
    if (!isDue(target)) continue;
    bySource.set(target.sourceId, [...(bySource.get(target.sourceId) ?? []), target]);
  }
  const results: BrightDataRunResult[] = [];
  if (bySource.size === 0) return results;
  let week: EngineWeek | null = null;
  let budgetBlocked: string | null = null;
  try {
    week = await loadEngineWeek(db, nowMs);
  } catch (error) {
    budgetBlocked = `${error instanceof Error ? error.message.slice(0, 160) : "учёт расхода движка не прочитался"} — платный запуск отложен (не платим вслепую), повторите вручную`;
  }
  let billingStop: string | null = null;
  for (const [sourceId, targets] of bySource) {
    const now = new Date(nowMs).toISOString();
    let source: Awaited<ReturnType<typeof readSource>> | null = null;
    if (billingStop) {
      // Деньги кончились на предыдущем источнике: этот в день покупки тоже не куплен — та же причина в «Источниках», без новых вызовов.
      const message = `не куплено: Bright Data — ${billingStop}`.slice(0, 400);
      try {
        source = await readSource(db, sourceId);
        await mark(db, sourceId, { capabilities: writeTriggerFailure(source.capabilities, { at: now, message }), last_attempt_at: now, last_error: `Bright Data: ${message}` });
      } catch {
        // запись причины не удалась — итог прогона всё равно её называет
      }
      results.push({ sourceId, phase: "trigger", ok: false, billing: true, triggered: 0, error: billingStop });
      continue;
    }
    const pending: PendingSnapshot[] = [];
    let bought: Record<string, string> = {};
    let started = 0;
    // Отказы Bright Data по отдельным целям (фильтр не принят): цель не куплена, остальные покупаются.
    const rejected: string[] = [];
    // Цели, не поместившиеся в общий потолок движка: не куплены, остальные — по своему остатку.
    const refused: string[] = [];
    // Покупка без сбоя снимает сбой прошлого запуска; сбой этого запуска — записывается заново (см. ниже).
    const queue = (caps: unknown) => writeTriggerFailure(writeBought(writePending(caps, pending), bought, nowMs), null);
    const failed = (caps: unknown, message: string) => writeTriggerFailure(started > 0 ? queue(caps) : caps, { at: now, message });
    try {
      source = await readSource(db, sourceId);
      pending.push(...readPending(source.capabilities).filter((p) => pendingAlive(p, nowMs)));
      bought = readBought(source.capabilities);
      if (week) week = inFlight(week, source.capabilities, sourceId, nowMs);
      for (const target of targets) {
        // Платный запуск не идемпотентен: повторная доставка крона (или второй вызов) купила бы те же выборки ещё раз ($2,5 за 1 000
        // записей). Пока по цели ждёт неснятая проба или её купили меньше суток назад (выборку уже забрали) — новую не заказываем;
        // у набора цель — раздел (часть раздела), а не фильтр: сменили фильтр — раздел в тот же день второй раз не покупаем.
        // Осознанный повтор — `force=1`.
        const signature = targetSignature(target);
        const key = purchaseKey({ ...target, targetKey: signature });
        if (!options.force && (pending.some((p) => purchaseKey(p) === key) || boughtRecently(bought[key], nowMs))) continue;
        // Потолок движка — до вызова: оценка сверху, а платим по пришедшим записям.
        const kind = targetKind(target);
        const estimate = targetMaxUsd(target);
        const refusal = budgetBlocked ?? (week && kind ? engineRefusal(week, kind, estimate, engine, need) : null);
        if (refusal) {
          refused.push(`${sectionLabel(target)} — ${refusal}`);
          continue;
        }
        let snapshotId: string;
        try {
          snapshotId = target.kind === "dataset"
            ? await filterDataset(target.datasetId, target.filter, target.recordsLimit ?? 50)
            : await triggerCollection({ datasetId: target.datasetId, discoverBy: target.discoverBy, inputs: target.inputs, limitPerInput: target.limitPerInput });
        } catch (error) {
          // Нет денег — стоп всего запуска: следующие цели получили бы тот же ответ.
          if (isBrightDataBilling(error)) {
            billingStop = billingReason(error);
            break;
          }
          // Окончательный отказ по этой цели (фильтр части не принят и т. п.) — денег не взято, повтор бессмыслен: называем и покупаем
          // следующие (сбой курток коллабораций не оставляет без покупки их сумки). 429, 5xx, таймаут, сбой связи — стоп, как раньше.
          if (!isPermanentDownloadError(error)) throw error;
          rejected.push(`${sectionLabel(target)} — ${error instanceof Error ? error.message.slice(0, 160) : "отказ"}`);
          continue;
        }
        pending.push({
          snapshotId, datasetId: target.datasetId, direction: target.direction, method: target.method, triggeredAt: now, kind: target.kind, targetKey: signature,
          ...(target.kind === "dataset" ? { recordsLimit: target.recordsLimit ?? 50, coverage: filterSignature(target.filter) } : {}),
          ...(target.part ? { part: target.part } : {}),
        });
        bought[key] = now;
        started += 1;
        if (week && kind) week = addToWeek(week, kind, estimate);
        // Номер оплаченной пробы пишем СРАЗУ, а не после цикла: сбой следующей цели (429, таймаут 30 с, 5xx) иначе терял бы уже купленные
        // выборки — их номеров нигде не осталось бы, и повторный запуск купил бы всё заново.
        await mark(db, sourceId, { capabilities: queue(source.capabilities), last_attempt_at: now, last_error: null });
      }
      const problems = [
        billingStop ? `Bright Data — ${billingStop}` : null,
        rejected.length > 0 ? `не куплено: ${rejected.join("; ")}` : null,
        refused.length > 0 ? `не куплено по потолку движка: ${refused.join("; ")}` : null,
      ].filter((p): p is string => Boolean(p));
      if (problems.length > 0) {
        // Сбой запуска хранится отдельно от last_error (capabilities.brightdata_trigger_failure): сбор в 06:30 перепишет last_error,
        // а этот сбой присоединит к своим ошибкам — иначе не купленная часть раздела пропала бы из «Источников» через полтора часа.
        const message = problems.join("; ").slice(0, 400);
        await mark(db, sourceId, { capabilities: failed(source.capabilities, message), last_attempt_at: now, last_error: `Bright Data: ${message}${billingStop && started > 0 ? ` (оплачено и сохранено проб: ${started})` : ""}` });
        results.push({ sourceId, phase: "trigger", ok: false, error: billingStop ?? message, triggered: started, pending: pending.length, ...(billingStop ? { billing: true } : {}), ...(refused.length ? { refusedByBudget: refused.length } : {}) });
        continue;
      }
      if (started === 0) continue;
      results.push({ sourceId, phase: "trigger", ok: true, triggered: started, pending: pending.length });
    } catch (error) {
      const message = [error instanceof Error ? error.message.slice(0, 200) : "ошибка запуска", ...(rejected.length ? [`не куплено: ${rejected.join("; ")}`] : [])].join("; ").slice(0, 400);
      // Если сбой пришёл при самой записи уже оплаченной пробы — ещё одна попытка сохранить очередь вместе с причиной одним обращением.
      const patch: Record<string, unknown> = { last_attempt_at: now, last_error: `Bright Data: ${message}${started > 0 ? ` (оплачено и сохранено проб: ${started})` : ""}` };
      if (source) patch.capabilities = failed(source.capabilities, message);
      await mark(db, sourceId, patch).catch(() => undefined);
      results.push({ sourceId, phase: "trigger", ok: false, error: message, ...(started > 0 ? { triggered: started, pending: pending.length } : {}) });
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
  // Готовый набор — полный раздел (упёрся в потолок → только окно); сборщик по
  // слову/топу раздела (ASOS, H&M) видит лишь верх выдачи — всегда окно. Часть
  // раздела (CHAQUETA Zara, коллаборации Uniqlo) — тоже окно: её отсутствие не
  // говорит, что вещь пропала из раздела, а «пропало» судится по полному прогону.
  const coverage: RunCoverage = snapshot.kind === "dataset" && !snapshot.part ? (quiet ? "window" : "full") : "window";
  return ingestRecords(db, source, snapshot, records, deadline, { coverage, quiet, churnGuard, drainOrphans: snapshot.kind === "dataset", imagesKnown: snapshot.kind === "dataset", part: snapshot.part ?? null });
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
    /**
     * Насколько полно увидели раздел — для журнала прогонов (слой наблюдений).
     * По умолчанию выводится из quiet; база всегда полная.
     */
    coverage?: RunCoverage;
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
    /** Часть раздела (CHAQUETA Zara, коллаборации Uniqlo) — пометка прогона в журнале наблюдений. */
    part?: string | null;
  } = {},
): Promise<IngestResult> {
  const quiet = Boolean(options.quiet);
  const churnGuard = Boolean(options.churnGuard);
  const records = uniqueRecords(mapped);
  const relevant = records.filter((r) => classifyItem(asCatalogItem(r), [target.direction]) === target.direction);
  const { known, orphans, livePhotos } = await knownIds(db, source.sourceId, target.direction);
  // Строки, которые прежде попали в раздел, а теперь не наши (штаны, платья, посуда): снимаем раздел.
  const dropped = records.filter((r) => known.has(r.sourceItemId) && classifyItem(asCatalogItem(r), ["jackets", "bags"]) === null).map((r) => r.sourceItemId);
  if (dropped.length) await clearDirection(db, source.sourceId, dropped).catch(() => 0);
  const plan = crawlPlan(known, relevant.map(asCatalogItem));
  const unseen = plan.fresh.filter((i) => !options.freshOnly || options.freshOnly.has(i.sourceItemId));
  // Новинка — новая МОДЕЛЬ: расцветка уже известной модели (ASOS, H&M) ложится базой, а не отдельной находкой.
  const knownModels = plan.baseline ? new Set<string>() : await loadKnownModelKeys(db, source.sourceId, target.direction);
  const fresh = new Set(newModelsOnly(unseen, (i) => modelKey({ sourceId: source.sourceId, sourceItemId: i.sourceItemId, title: i.title }), knownModels).fresh.map((i) => i.sourceItemId));
  const churn = churnGuard && !plan.baseline && !quiet && looksLikeChurn(fresh.size, relevant.length);
  const asBaseline = plan.baseline || quiet || churn;
  const now = new Date().toISOString();
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  for (const r of relevant) {
    const row = {
      source_id: source.sourceId, source_item_id: r.sourceItemId, handle: r.url, title: r.title, product_type: r.category, direction: target.direction, last_seen_at: now,
      // ASOS и H&M — карточка на цвет: ключ склеивает расцветки одной модели.
      model_key: modelKey({ sourceId: source.sourceId, sourceItemId: r.sourceItemId, title: r.title }),
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
  // Слой наблюдений: журнал прогона + снимок присутствия раздела на сегодня.
  // Доверие к новизне — от вызывающего; иначе по quiet (обрезанная выдача или
  // упёршийся набор — окно, не полный раздел).
  // Полнота — от вызывающего: первый проход (база) её не повышает, окно остаётся окном.
  const coverage: RunCoverage = options.coverage ?? (quiet ? "window" : "full");
  const items: SnapshotItem[] = relevant.map((r) => ({ sourceItemId: r.sourceItemId, direction: target.direction, title: r.title, brand: r.brand ?? source.name, images: r.images }));
  await recordObservation(db, {
    sourceId: source.sourceId, direction: target.direction, coverage,
    seen: relevant.length, added, startedAt: now, snapshotId: (target as { snapshotId?: string }).snapshotId ?? null, part: options.part ?? null,
  }, items);
  return { collected: relevant.length, added, baseline: asBaseline, churn, missingPhotos };
}

const ZARA_ROW_COLUMNS = "source_item_id,handle,reference_id,image_urls";

/**
 * Модели Zara в каталоге без живых фото (за 30 дней): фото нет вовсе или все
 * ссылки — удалённые Zara снимки старого вида (их база хранит до следующего сбора).
 */
async function zaraRowsWithoutPhotos(db: SupabaseClient): Promise<Array<{ source_item_id: string; handle: string | null; reference_id: string | null }>> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  // Все строки окна, а не первая тысяча по id: после первой волны фото вся первая тысяча — строки с фото, и модели дальше нее
  // не получали фото никогда (комментарий «в следующие недели» не выполнялся).
  let data: Array<{ source_item_id: string; handle: string | null; reference_id: string | null; image_urls: unknown }>;
  try {
    data = await loadAllSupabasePages((from, to) => db.from("assortment_source_items").select(ZARA_ROW_COLUMNS)
      .eq("source_id", ZARA_PHOTOS.sourceId).not("direction", "is", null).gte("last_seen_at", since)
      .order("source_item_id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: typeof data | null; error: { message: string } | null }>, { label: "Строки Zara без фото", pageSize: 1000 });
  } catch (error) {
    if (isMissingColumnError(error instanceof Error ? error : new Error(String(error)))) return [];
    throw error;
  }
  // Первыми — модели с находкой в ленте: выборка фото берёт до 400 моделей по порядку, и строки части раздела (CHAQUETA Zara легла
  // базой с мёртвыми снимками — до нескольких сотен) иначе вытесняли бы свежие находки, и те неделю стояли бы в ленте без фото.
  // Сортировка устойчивая: внутри групп — прежний порядок по номеру.
  return data
    .filter((r) => !Array.isArray(r.image_urls) || r.image_urls.every((u) => typeof u !== "string" || isDeadImageUrl(u)))
    .sort((a, b) => Number(Boolean(b.reference_id)) - Number(Boolean(a.reference_id)));
}

/**
 * Снять мёртвые ссылки Zara у строк каталога, где живых нет: иначе модель
 * числится «с фото», а показывает заглушку. Бесплатно — без выборки.
 */
export async function clearDeadZaraPhotos(db: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  let data: Array<{ source_item_id: string; image_urls: unknown }>;
  try {
    data = await loadAllSupabasePages((from, to) => db.from("assortment_source_items").select("source_item_id,image_urls")
      .eq("source_id", ZARA_PHOTOS.sourceId).not("image_urls", "is", null).gte("last_seen_at", since)
      .order("source_item_id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: typeof data | null; error: { message: string } | null }>, { label: "Мёртвые фото Zara", pageSize: 1000 });
  } catch (error) {
    if (isMissingColumnError(error instanceof Error ? error : new Error(String(error)))) return 0;
    throw error;
  }
  const dead = data
    .filter((r) => Array.isArray(r.image_urls) && r.image_urls.length > 0 && r.image_urls.every((u) => typeof u !== "string" || isDeadImageUrl(u)))
    .map((r) => ({ source_id: ZARA_PHOTOS.sourceId, source_item_id: r.source_item_id, image_urls: null }));
  await upsertSourceItems(db, dead);
  return dead.length;
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

/** Оплаченные записи одной выборки — в учёт движка оценкой (записи × цена метода). */
interface Spent {
  kind: string;
  records: number;
  usd: number;
}

/**
 * Записать расход выборок, снятых из очереди: только ПОСЛЕ того, как очередь источника сохранена, — выборка, которую ещё раз скачает
 * следующий сбор (сбой записи очереди), иначе учлась бы дважды. Сбой записи учёта выборки не теряет: он назван в итоге сбора.
 */
async function recordSpend(db: SupabaseClient, spent: Spent[], result: BrightDataRunResult): Promise<void> {
  const byKind = new Map<string, { records: number; usd: number }>();
  for (const s of spent) {
    const agg = byKind.get(s.kind) ?? { records: 0, usd: 0 };
    byKind.set(s.kind, { records: agg.records + s.records, usd: agg.usd + s.usd });
  }
  const problems: string[] = [];
  let total = 0;
  for (const [kind, agg] of byKind) {
    try {
      await addEngineUsage(db, Date.now(), kind, { calls: agg.records, costUsd: agg.usd });
      total += agg.usd;
    } catch (error) {
      problems.push(`${kind}: ${error instanceof Error ? error.message.slice(0, 120) : "не записался"}`);
    }
  }
  if (total > 0) result.spentUsd = Math.round(total * 100_000) / 100_000;
  if (problems.length > 0) result.usageError = `расход не записался в учёт (${problems.join("; ")})`;
}

/** Записи выборки сборщика без строк-ошибок (`include_errors`): платим за собранное. */
const collectedRecords = (rows: unknown[]) => rows.filter((r) => r && typeof r === "object" && !(r as { error?: unknown }).error).length;

/**
 * Сбор готовых проб. Не готова — ждёт следующего захода; старше суток — снимается. Расход пришедших записей — в учёт движка (оценка).
 * «Нет денег» (402) — стоп сбора одной причиной: эта и все ещё не забранные выборки остаются в очереди с пометкой (ждут пополнения до
 * двух недель), у остальных источников очередь не трогается, кроме этой пометки.
 */
export async function collectBrightData(db: SupabaseClient, deadline: number, options: { engine?: EngineBudgetConfig } = {}): Promise<BrightDataRunResult[]> {
  const engine = options.engine ?? engineBudgetConfig();
  const sourceIds = [...new Set(BRIGHTDATA_TARGETS.map((t) => t.sourceId))];
  const results: BrightDataRunResult[] = [];
  let billingStop: string | null = null;
  for (const sourceId of sourceIds) {
    const now = new Date().toISOString();
    if (billingStop) {
      // Деньги кончились на предыдущем источнике: выборки этого ждут пополнения — только пометка, без скачиваний.
      try {
        const source = await readSource(db, sourceId);
        const waiting = readPending(source.capabilities);
        const photos = sourceId === ZARA_PHOTOS.sourceId ? readPhotoPending(source.capabilities) : [];
        if (waiting.length + photos.length === 0) continue;
        const caps = writePending(source.capabilities, waiting.map((p) => hold(p, now)));
        await mark(db, sourceId, {
          capabilities: sourceId === ZARA_PHOTOS.sourceId ? writePhotoPending(caps, photos.map((p) => hold(p, now))) : caps,
          last_attempt_at: now, last_error: `Bright Data: ${billingStop}; оплаченные выборки ждут в очереди: ${waiting.length + photos.length}`,
        });
        results.push({ sourceId, phase: "collect", ok: false, billing: true, collected: 0, added: 0, pending: waiting.length + photos.length, error: billingStop });
      } catch (error) {
        results.push({ sourceId, phase: "collect", ok: false, billing: true, error: `${billingStop}; пометка очереди не записалась: ${error instanceof Error ? error.message.slice(0, 120) : "сбой"}` });
      }
      continue;
    }
    const result: BrightDataRunResult = { sourceId, phase: "collect", ok: true, collected: 0, added: 0 };
    const spent: Spent[] = [];
    try {
      const source = await readSource(db, sourceId);
      const left: PendingSnapshot[] = [];
      const errors: string[] = [];
      const coverage = readCoverage(source.capabilities);
      const bought = readBought(source.capabilities);
      // Сбой запуска (часть раздела не куплена): сбор пишет last_error заново — присоединяем, пока запуск без сбоя его не снимет.
      const triggerFailure = readTriggerFailure(source.capabilities);
      const triggerNote = triggerFailureNote(triggerFailure, Date.now());
      // Покупка не состоялась (окончательный отказ Bright Data) — отметку снимаем: повторный запуск в тот же день может заказать снова.
      const release = (snapshot: PendingSnapshot) => {
        const key = purchaseKey(snapshot);
        if (bought[key] === snapshot.triggeredAt) delete bought[key];
      };
      const stopOnBilling = (error: unknown) => {
        billingStop = billingReason(error);
      };
      for (const snapshot of readPending(source.capabilities)) {
        if (billingStop) {
          left.push(hold(snapshot, now));
          continue;
        }
        if (Date.now() > deadline) {
          left.push(snapshot);
          continue;
        }
        const kind = targetKind(snapshot) ?? "brightdata:other";
        if (snapshot.kind === "dataset") {
          const rows = await downloadDatasetRecords(snapshot.snapshotId).catch((e) => {
            if (isBrightDataBilling(e)) {
              stopOnBilling(e);
              left.push(hold(snapshot, now));
              return undefined;
            }
            errors.push(String(e?.message ?? e).slice(0, 160));
            // Оплаченная выборка не теряется на временном сбое скачивания (таймаут 60 с, 429, 5xx): остаётся в очереди до суток.
            if (!isPermanentDownloadError(e) && pendingAlive(snapshot, Date.now())) left.push(snapshot);
            else if (isPermanentDownloadError(e)) release(snapshot);
            return undefined;
          });
          if (rows === undefined) continue;
          if (rows === null) {
            if (pendingAlive(snapshot, Date.now())) left.push(snapshot);
            else errors.push(`выборка ${snapshot.snapshotId} не готова за сутки`);
            continue;
          }
          // За все пришедшие записи заплачено (и за отсеянные правилом части) — в учёт все.
          spent.push({ kind, records: rows.length, usd: brightdataUsd(rows.length, "dataset") });
          // Потолок и полнота — по всем пришедшим записям (за них заплачено); в раздел идут только прошедшие правило части.
          const verdict = datasetVerdict(rows.length, snapshot, coverage[coverageKey(snapshot)]);
          const done = await processSnapshot(db, { sourceId, name: source.name }, snapshot, deadline, partRecords(snapshot, rows), verdict.quiet, true);
          if (verdict.remember && snapshot.coverage) coverage[coverageKey(snapshot)] = snapshot.coverage;
          if (verdict.warning) errors.push(verdict.warning);
          if (done.churn) errors.push(`${sectionLabel(snapshot)}: ${done.collected} моделей, из них слишком много новых разом — похоже на пересборку набора, сбор лёг базой`);
          result.collected = (result.collected ?? 0) + done.collected;
          result.added = (result.added ?? 0) + done.added;
          result.baseline = result.baseline || done.baseline;
          continue;
        }
        const progress = await snapshotProgress(snapshot.snapshotId).catch((e) => ({ status: isBrightDataBilling(e) ? "billing" : "error", error: e }));
        if (progress.status === "billing") {
          stopOnBilling((progress as { error: unknown }).error);
          left.push(hold(snapshot, now));
          continue;
        }
        if (progress.status === "ready") {
          let raw: unknown[];
          try {
            raw = await downloadRecords(snapshot.snapshotId);
          } catch (e) {
            if (!isBrightDataBilling(e)) throw e;
            stopOnBilling(e);
            left.push(hold(snapshot, now));
            continue;
          }
          const records = collectedRecords(raw);
          spent.push({ kind, records, usd: brightdataUsd(records, "collector") });
          const done = await processSnapshot(db, { sourceId, name: source.name }, snapshot, deadline, raw);
          result.collected = (result.collected ?? 0) + done.collected;
          result.added = (result.added ?? 0) + done.added;
          result.baseline = result.baseline || done.baseline;
        } else if (progress.status === "failed") {
          errors.push(`проба ${snapshot.snapshotId} не удалась у Bright Data`);
          release(snapshot);
        } else if (pendingAlive(snapshot, Date.now())) {
          left.push(snapshot);
        } else {
          errors.push(`проба ${snapshot.snapshotId} не готова за сутки`);
        }
      }
      // Фото Zara: применить готовую выборку; после свежего сбора Zara — заказать фото тем, у кого их нет.
      let photoLeft: PhotoPending[] = [];
      if (sourceId === ZARA_PHOTOS.sourceId) {
        for (const pending of readPhotoPending(source.capabilities)) {
          if (billingStop) {
            photoLeft.push(hold(pending, now));
            continue;
          }
          const rows = Date.now() > deadline ? null : await downloadDatasetRecords(pending.snapshotId).catch((e) => {
            if (isBrightDataBilling(e)) {
              stopOnBilling(e);
              photoLeft.push(hold(pending, now));
              return undefined;
            }
            errors.push(`фото Zara: ${String(e?.message ?? e).slice(0, 120)}`);
            if (!isPermanentDownloadError(e) && pendingAlive(pending, Date.now())) photoLeft.push(pending);
            return undefined;
          });
          if (rows === undefined) continue;
          if (rows === null) {
            if (pendingAlive(pending, Date.now())) photoLeft.push(pending);
            continue;
          }
          try {
            result.photos = (result.photos ?? 0) + await applyZaraPhotos(db, rows, deadline);
            // В учёт — только применённая выборка: не применилась — останется в очереди и учтётся, когда её заберут.
            spent.push({ kind: ZARA_PHOTOS_KIND, records: rows.length, usd: brightdataUsd(rows.length, "dataset") });
          } catch (e) {
            // Оплаченная выборка не пропадает: остаётся в очереди, ошибка — в «Источниках».
            errors.push(`фото Zara: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
            photoLeft.push(pending);
          }
        }
        await clearDeadZaraPhotos(db).catch((e) => { errors.push(`фото Zara: ${String(e?.message ?? e).slice(0, 120)}`); return 0; });
        if (!billingStop && (result.collected ?? 0) > 0 && photoLeft.length === 0) {
          // Платная выборка фото — под общим потолком движка (после Zara и Uniqlo по средам; расход этого сбора уже в неделе).
          const refusal = await photosRefusal(db, engine, spent);
          if (refusal) errors.push(`фото Zara не заказаны: ${refusal}`);
          else {
            const next = await triggerZaraPhotos(db).catch((e) => {
              if (isBrightDataBilling(e)) stopOnBilling(e);
              else errors.push(`фото Zara: ${String(e?.message ?? e).slice(0, 120)}`);
              return null;
            });
            if (next) photoLeft = [next];
          }
        }
      }
      if (billingStop) errors.unshift(`${billingStop}; оплаченные выборки ждут в очереди: ${left.length + photoLeft.length}`);
      result.pending = left.length + photoLeft.length;
      const caps = writeTriggerFailure(writeBought(writeCoverage(writePending(source.capabilities, left), coverage), bought, Date.now()), triggerNote ? triggerFailure : null);
      const shown = triggerNote ? [triggerNote, ...errors] : errors;
      const patch: Record<string, unknown> = { capabilities: sourceId === ZARA_PHOTOS.sourceId ? writePhotoPending(caps, photoLeft) : caps, last_attempt_at: now, last_error: shown.length ? `Bright Data: ${shown.join("; ")}` : null };
      if ((result.collected ?? 0) > 0) patch.last_success_at = now;
      await mark(db, sourceId, patch);
      await recordSpend(db, spent, result);
      if (billingStop) result.billing = true;
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
 * Помещается ли новая выборка фото Zara в общий потолок движка: неделя из учёта плюс расход этого сбора, ещё не записанный. null —
 * помещается (или таблицы учёта нет — прежнее правило); иначе причина. Учёт не прочитался — не заказываем вслепую.
 */
async function photosRefusal(db: SupabaseClient, engine: EngineBudgetConfig, spent: Spent[]): Promise<string | null> {
  let week: EngineWeek | null;
  try {
    week = await loadEngineWeek(db);
  } catch (error) {
    return `${error instanceof Error ? error.message.slice(0, 120) : "учёт расхода не прочитался"} — не заказываем вслепую`;
  }
  if (!week) return null;
  for (const s of spent) week = addToWeek(week, s.kind, s.usd);
  return engineRefusal(week, ZARA_PHOTOS_KIND, ZARA_PHOTOS_MAX_USD, engine);
}

/**
 * Ручной запуск фото Zara (?phase=photos): готовую выборку — применить сразу;
 * неготовую свежую — ждать; новую заказать, только если до вызова ничего не
 * ждало (не покупаем выборку на каждый вызов) и она помещается в общий потолок
 * движка. «Нет денег» (402) — выборка остаётся в очереди с пометкой.
 */
export async function requestZaraPhotos(db: SupabaseClient, deadline: number, options: { engine?: EngineBudgetConfig } = {}): Promise<BrightDataRunResult> {
  const engine = options.engine ?? engineBudgetConfig();
  const source = await readSource(db, ZARA_PHOTOS.sourceId);
  const caps = (source.capabilities && typeof source.capabilities === "object" ? source.capabilities : {}) as Record<string, unknown>;
  const result: BrightDataRunResult = { sourceId: ZARA_PHOTOS.sourceId, phase: "trigger", ok: true, triggered: 0, photos: 0 };
  const left: PhotoPending[] = [];
  const spent: Spent[] = [];
  const waiting = readPhotoPending(caps);
  const fresh = (p: PhotoPending) => pendingAlive(p, Date.now());
  const now = new Date().toISOString();
  let billing: string | null = null;
  result.detail = [];
  for (const pending of waiting) {
    if (billing) {
      left.push(hold(pending, now));
      continue;
    }
    let rows: unknown[] | null;
    try {
      rows = await downloadDatasetRecords(pending.snapshotId);
    } catch (e) {
      if (isBrightDataBilling(e)) {
        billing = billingReason(e);
        left.push(hold(pending, now));
        result.detail.push(`${pending.snapshotId}: ждёт — ${billing}`);
        continue;
      }
      // Окончательный отказ Bright Data (4xx, кроме 408 и 429) — снимаем: иначе выборка висела бы вечно и не давала заказать новую.
      // Сбой связи, таймаут, 5xx, 408 и 429 — временные: оплаченная выборка ждёт до суток, как и в плановом сборе (одно правило на оба пути).
      const message = String((e as Error)?.message ?? e).slice(0, 200);
      const keep = !isPermanentDownloadError(e) && fresh(pending);
      if (keep) left.push(pending);
      result.detail.push(`${pending.snapshotId}: ${keep ? "ждём" : "снята"} — ${message}`);
      continue;
    }
    if (rows === null) {
      if (fresh(pending)) left.push(pending);
      result.detail.push(`${pending.snapshotId}: ещё собирается${fresh(pending) ? "" : " больше суток — снята"}`);
      continue;
    }
    const applied = await applyZaraPhotos(db, rows, deadline);
    spent.push({ kind: ZARA_PHOTOS_KIND, records: rows.length, usd: brightdataUsd(rows.length, "dataset") });
    result.photos = (result.photos ?? 0) + applied;
    result.detail.push(`${pending.snapshotId}: записей ${rows.length}, фото получили ${applied}`);
  }
  const cleared = await clearDeadZaraPhotos(db);
  if (cleared) result.detail.push(`мёртвых ссылок снято: ${cleared}`);
  // Новую выборку — только если ничего не ждало: применили готовую — на этом всё (повторный вызов не покупает ещё одну).
  if (waiting.length === 0) {
    const refusal = await photosRefusal(db, engine, spent);
    if (refusal) {
      result.ok = false;
      result.error = `новая выборка не заказана: ${refusal}`;
      result.detail.push(result.error);
    } else {
      try {
        const next = await triggerZaraPhotos(db);
        if (next) {
          left.push(next);
          result.triggered = 1;
        }
      } catch (e) {
        if (!isBrightDataBilling(e)) throw e;
        billing = billingReason(e);
      }
    }
  }
  if (billing) {
    result.ok = false;
    result.billing = true;
    result.error = billing;
  }
  result.pending = left.length;
  await mark(db, ZARA_PHOTOS.sourceId, { capabilities: writePhotoPending(caps, left) });
  await recordSpend(db, spent, result);
  return result;
}

/**
 * Строка журнала прогона Bright Data (sync_log). «Нет денег» (402) — `error` с одной причиной и меткой `[stop:billing]` в конце: по ней
 * сторож задач шлёт одну тревогу сразу, а полоска и экран «Синхронизация» метку вырезают. Остальное — как раньше: все источники
 * со сбоем — `error`, часть — `partial`. Расход, не записанный в учёт, — `partial` с причиной (выборки при этом не потеряны).
 */
export function brightdataRunLog(results: BrightDataRunResult[]): { status: "ok" | "partial" | "error"; note: string | null } {
  const billing = results.find((r) => r.billing);
  if (billing) {
    const held = results.filter((r) => r.billing).map((r) => r.sourceId);
    const reason = billing.error?.split("; ")[0] ?? "нет денег или аккаунт не активен (402)";
    return { status: "error", note: `Bright Data: ${reason} — остановлено (${held.join(", ")}), оплаченные выборки ждут в очереди [stop:billing]` };
  }
  const failed = results.filter((r) => !r.ok);
  const usage = results.filter((r) => r.usageError).map((r) => `${r.sourceId}: ${r.usageError}`);
  const status = failed.length === 0 ? (usage.length ? "partial" : "ok") : failed.length < results.length ? "partial" : "error";
  const note = [...failed.map((r) => `${r.sourceId}: ${r.error}`), ...usage].join("; ");
  return { status, note: note || null };
}
