import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { moscowToday, shiftIsoDay } from "@/lib/sync/moscowDay";
import {
  changesTabVisible, computeChanges, DISAPPEAR_FULL_RUNS, isFirstSundayOfMonth, MONTH_PERIOD_DAYS, planChanges, runsToRead, seasonCaption,
  type ChangeItem, type ChangeKind, type ChangeRun, type ChangesPeriod, type SnapshotLite, type StreamKind, type StreamSummary,
} from "./appearance";
import { partLabel } from "./brightdataCatalog";
import { rowsByIds } from "./byIds";
import { catalogProductUrl, thumbUrl } from "./catalog";
import { ASSORTMENT_BASE_PATH, ASSORTMENT_DIRECTIONS, type AssortmentDirection } from "./constants";
import { isMissingAssortmentSchema, isMissingColumnError } from "./errors";
import { summarizeHistory, type HistoryStatus, type RunRow } from "./observationState";
import { isRuSource } from "./ruMarket";

/**
 * «Появилось / пропало» — чтение базы для вкладки «Изменения» и воскресной сводки. Журнал прогонов — за 120 дней (как «История
 * наблюдений»: статусы совпадают), снимки — только нужных прогонов: последние и на начало периода, по разделу, без фото и меток
 * (фото и ссылки — из каталога, и только для найденных моделей). Каталог заодно говорит, когда модель увидели впервые: вернувшаяся
 * (снова в наличии) — не «появилось». Всё — через loadAllSupabasePages: PostgREST молча режет на 1 000.
 * Таблиц слоя наблюдений нет (миграция 202610050001) — вкладки нет, причина названа одной строкой.
 */

const HISTORY_DAYS = 120;
const RUN_COLUMNS = "run_id,source_id,direction,observed_on,coverage,seen,added,error,started_at";
/** Снимки читаются по нескольку прогонов одновременно: на раздел 10–20 источников по 2–4 прогона — последовательно это секунды. */
const SNAPSHOT_CONCURRENCY = 12;
/** Карточек в группе не больше: при массовой смене (сменился обход) список не должен весить мегабайты. Числа — полные. */
export const CHANGES_GROUP_LIMIT = 200;

export const CHANGES_UNAVAILABLE = "«Изменения» появятся после обновления базы: нужен журнал прогонов (миграция 202610050001_assortment_observation_log.sql).";

interface SourceInfo {
  name: string;
  seedUrl: string | null;
  categories: string[] | null;
}

type RunRowWithId = RunRow & { run_id: string };

interface Context {
  today: string;
  sources: Map<string, SourceInfo>;
  runs: RunRowWithId[];
}

function tableMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? "");
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "PGRST205" || isMissingAssortmentSchema(new Error(message));
}

async function loadSources(db: SupabaseClient): Promise<Map<string, SourceInfo>> {
  const { data, error } = await db.from("assortment_sources").select("source_id,name,categories,seed_urls");
  if (error) throw Object.assign(new Error(error.message), { code: (error as { code?: string }).code });
  const map = new Map<string, SourceInfo>();
  for (const row of (data ?? []) as Array<{ source_id: string; name: string | null; categories: unknown; seed_urls: unknown }>) {
    const seeds = Array.isArray(row.seed_urls) ? row.seed_urls.filter((s): s is string => typeof s === "string" && /^https?:\/\//.test(s)) : [];
    const categories = Array.isArray(row.categories) ? row.categories.map(String) : null;
    map.set(String(row.source_id), { name: row.name ?? String(row.source_id), seedUrl: seeds[0] ?? null, categories });
  }
  return map;
}

async function loadRuns(db: SupabaseClient, today: string): Promise<RunRowWithId[]> {
  const since = shiftIsoDay(today, -HISTORY_DAYS);
  const load = (columns: string) => loadAllSupabasePages<RunRowWithId>((from, to) => db.from("assortment_run")
    .select(columns)
    .gte("observed_on", since)
    .order("started_at", { ascending: true })
    .order("run_id", { ascending: true })
    .range(from, to) as unknown as PromiseLike<{ data: RunRowWithId[] | null; error: { message: string } | null }>, { label: "Журнал прогонов", pageSize: 1000, concurrency: 3 });
  try {
    return await load(`${RUN_COLUMNS},part`);
  } catch (error) {
    // Миграции 202610060010 (пометка части раздела) ещё нет — без неё: части тогда не отличить от окон, как до неё.
    if (!isMissingColumnError({ message: error instanceof Error ? error.message : String(error) })) throw error;
    return load(RUN_COLUMNS);
  }
}

/** Источники и журнал прогонов; null — таблиц слоя наблюдений нет. */
async function loadContext(db: SupabaseClient, now: Date | number): Promise<Context | null> {
  const today = moscowToday(now);
  try {
    const [sources, runs] = await Promise.all([loadSources(db), loadRuns(db, today)]);
    return { today, sources, runs };
  } catch (error) {
    if (tableMissing(error)) return null;
    throw error;
  }
}

/**
 * Прогоны раздела: свои и «целиком» (Shopify обходит куртки и сумки одним прогоном). Без «Рынка РФ» (замер рынка, не каталог бренда) и
 * без источников, у которых раздела нет в категориях: прогон Polène «целиком» не делает её источником курток.
 */
function sectionRuns(ctx: Context, direction: AssortmentDirection): RunRowWithId[] {
  return ctx.runs.filter((r) => {
    if (r.direction != null && r.direction !== direction) return false;
    if (isRuSource(r.source_id)) return false;
    const categories = ctx.sources.get(r.source_id)?.categories;
    return !categories || categories.length === 0 || categories.includes(direction);
  });
}

const toChangeRun = (r: RunRowWithId): ChangeRun => ({
  runId: String(r.run_id), sourceId: r.source_id, direction: r.direction, observedOn: String(r.observed_on).slice(0, 10), startedAt: String(r.started_at), coverage: r.coverage, part: r.part ?? null,
});

async function pool<T, R>(list: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      out[index] = await run(list[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, worker));
  return out;
}

/**
 * Модели прогона в разделе: номер, название (для ключа модели) и бренд. Фильтр по дню и источнику — под индекс снимков
 * (observed_on, source_id); по run_id отдельного индекса нет. Порядок — по номеру: листание без дублей на границе страниц.
 */
async function loadRunModels(db: SupabaseClient, run: ChangeRun, direction: AssortmentDirection): Promise<SnapshotLite[]> {
  type Row = { source_item_id: string; title: string | null; brand: string | null };
  const rows = await loadAllSupabasePages<Row>((from, to) => db.from("assortment_item_snapshot")
    .select("source_item_id,title,brand")
    .eq("observed_on", run.observedOn)
    .eq("source_id", run.sourceId)
    .eq("run_id", run.runId)
    .eq("direction", direction)
    .order("source_item_id", { ascending: true })
    .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>, { label: `Снимок прогона ${run.sourceId} за ${run.observedOn}`, pageSize: 1000 });
  return rows.map((r) => ({ sourceItemId: String(r.source_item_id), title: r.title ?? null, brand: r.brand ?? null }));
}

interface CatalogRowLite {
  source_item_id: string;
  handle: string | null;
  reference_id: string | null;
  /** Когда обход впервые увидел строку (колонка таблицы с первой миграции каталога). */
  first_seen_at?: string | null;
  image_urls?: string[] | null;
  brand?: string | null;
  hidden_at?: string | null;
}

const CATALOG_BASE = "source_item_id,handle,reference_id,first_seen_at";

/**
 * Строки каталога найденных моделей (ссылка, фото, «скрыта», находка, когда увидели впервые) — пачками по источнику. У «появилось» и
 * «впервые в верху выдачи» — все номера модели (вернулась ли она, решает любой из них), у «пропало» — строка модели. Нет колонок
 * каталога — без них.
 */
async function loadCatalogRows(db: SupabaseClient, items: readonly ChangeItem[]): Promise<Map<string, CatalogRowLite>> {
  const bySource = new Map<string, Set<string>>();
  for (const item of items) {
    const ids = bySource.get(item.sourceId) ?? new Set<string>();
    for (const id of item.kind === "disappeared" ? [item.itemId] : [item.itemId, ...item.itemIds]) ids.add(id);
    bySource.set(item.sourceId, ids);
  }
  const out = new Map<string, CatalogRowLite>();
  await Promise.all([...bySource.entries()].map(async ([sourceId, idSet]) => {
    const ids = [...idSet];
    const read = (columns: string) => rowsByIds<CatalogRowLite>(ids, "Каталог изменений", (part, from, to) => db.from("assortment_source_items")
      .select(columns)
      .eq("source_id", sourceId)
      .in("source_item_id", part)
      .order("source_item_id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: CatalogRowLite[] | null; error: { message: string } | null }>);
    let rows: CatalogRowLite[];
    try {
      rows = await read(`${CATALOG_BASE},image_urls,brand,hidden_at`);
    } catch (error) {
      if (!isMissingColumnError({ message: error instanceof Error ? error.message : String(error) })) throw error;
      rows = await read(CATALOG_BASE);
    }
    for (const row of rows) out.set(`${sourceId}:${row.source_item_id}`, row);
  }));
  return out;
}

async function loadReferenceStatuses(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await rowsByIds<{ id: string; status: string }>([...new Set(ids)], "Статусы находок", (part, from, to) => db.from("assortment_references")
    .select("id,status")
    .in("id", part)
    .order("id", { ascending: true })
    .range(from, to) as unknown as PromiseLike<{ data: Array<{ id: string; status: string }> | null; error: { message: string } | null }>);
  return new Map(rows.map((r) => [String(r.id), String(r.status)]));
}

export interface ChangeCard {
  key: string;
  kind: ChangeKind;
  sourceId: string;
  sourceName: string;
  /** Часть раздела (название), если модель из неё. */
  part: string | null;
  itemId: string;
  title: string;
  brand: string;
  image: string | null;
  productUrl: string | null;
  referenceId: string | null;
  referenceStatus: string | null;
  /** Карточка находки, если модель уже среди находок. */
  findingHref: string | null;
  /** Строка нашлась в каталоге: «Отобрать» и «Не интересно» работают (нет — кнопок нет, а не серые). */
  inCatalog: boolean;
  seenOn: string;
  absentOn: string[];
  mass: boolean;
  /** База источника устарела (сборщик простаивал): сравнение на деле за столько дней, а не за период; null — база в порядке. */
  staleSpanDays: number | null;
}

export interface ChangesSourceView {
  sourceId: string;
  name: string;
  kind: StreamKind;
  part: string | null;
  status: StreamSummary["status"];
  /** Статус «Истории наблюдений» основного раздела (у частей — источника). */
  historyStatus: HistoryStatus | null;
  readyOn: string | null;
  disappearReady: boolean;
  disappearRunsMissing: number;
  latestOn: string | null;
  baseOn: string[];
  recentOn: string[];
  appeared: number;
  disappeared: number;
  firstInWindow: number;
  mass: boolean;
  /** Дней между базой и последним прогоном; null — базы нет. */
  spanDays: number | null;
  /** База старше начала периода больше чем на неделю — сборщик простаивал, сравнение за весь простой. */
  baseStale: boolean;
}

export interface ChangesGroups {
  appeared: ChangeCard[];
  disappeared: ChangeCard[];
  firstInWindow: ChangeCard[];
}

export type ChangesResult =
  | { available: false; reason: string }
  | {
    available: true;
    direction: AssortmentDirection;
    today: string;
    periodDays: number;
    /** Последний день до периода: прогоны не позже него — «на начало периода». */
    periodStart: string;
    disappearRuns: number;
    /** Подпись декабря–февраля к «пропало»; null — не сезон. */
    season: string | null;
    groups: ChangesGroups;
    /** Полные числа (карточек в группе — не больше CHANGES_GROUP_LIMIT); hidden — модели, скрытые кнопкой «Не интересно». */
    totals: { appeared: number; disappeared: number; firstInWindow: number; hidden: number };
    sources: ChangesSourceView[];
    tabVisible: boolean;
  };

type Ready = Extract<ChangesResult, { available: true }>;

const KIND_GROUP: Record<ChangeKind, keyof ChangesGroups> = { appeared: "appeared", disappeared: "disappeared", first_window: "firstInWindow" };
const streamKey = (sourceId: string, part: string | null) => `${sourceId}|${part ?? ""}`;

/** Порядок карточек: массовая смена — в конце; свежие прогоны выше; затем источник и название. */
function byOrder(a: ChangeCard, b: ChangeCard): number {
  return Number(a.mass) - Number(b.mass) || b.seenOn.localeCompare(a.seenOn) || a.sourceName.localeCompare(b.sourceName, "ru") || a.title.localeCompare(b.title, "ru");
}

async function buildDirection(db: SupabaseClient, ctx: Context, direction: AssortmentDirection, periodDays: number, mark?: (name: string) => void): Promise<Ready> {
  const rows = sectionRuns(ctx, direction);
  const histories = summarizeHistory(rows, ctx.today);
  const historyOf = new Map(histories.map((h) => [h.sourceId, h.status]));
  const plan = planChanges(rows.map(toChangeRun), ctx.today, periodDays);
  const reads = runsToRead(plan);
  const loaded = await pool(reads, SNAPSHOT_CONCURRENCY, async (run) => [run.runId, await loadRunModels(db, run, direction)] as const);
  mark?.("snapshots");
  const snapshots = new Map(loaded);
  // Первый проход — кандидаты по прогонам; каталог кандидатов говорит, когда модель увидели впервые; второй проход отбрасывает
  // вернувшиеся (снова в наличии, снова в верху выдачи) и пересчитывает числа и «массовую смену» без них.
  const candidates = computeChanges(plan, snapshots);
  const catalog = candidates.items.length ? await loadCatalogRows(db, candidates.items) : new Map<string, CatalogRowLite>();
  const computed = computeChanges(plan, snapshots, {
    firstSeenOn: (sourceId, itemId) => {
      const at = catalog.get(`${sourceId}:${itemId}`)?.first_seen_at;
      return at && Number.isFinite(Date.parse(at)) ? moscowToday(Date.parse(at)) : null;
    },
  });
  const statuses = await loadReferenceStatuses(db, [...catalog.values()].map((r) => r.reference_id).filter((id): id is string => Boolean(id)));
  mark?.("catalog");

  const nameOf = (sourceId: string) => ctx.sources.get(sourceId)?.name ?? sourceId;
  const groups: ChangesGroups = { appeared: [], disappeared: [], firstInWindow: [] };
  const perStream = new Map<string, { appeared: number; disappeared: number; firstInWindow: number }>();
  let hidden = 0;
  for (const item of computed.items) {
    const row = catalog.get(`${item.sourceId}:${item.itemId}`);
    // «Не интересно» — решение человека по модели: в «Изменениях» её больше нет (вернуть — в «Каталогах брендов»).
    if (row?.hidden_at) {
      hidden += 1;
      continue;
    }
    const source = ctx.sources.get(item.sourceId);
    const image = (row?.image_urls ?? []).map((u) => thumbUrl(u)).find((u): u is string => Boolean(u)) ?? null;
    const card: ChangeCard = {
      key: `${item.kind}:${item.modelKey}`,
      kind: item.kind,
      sourceId: item.sourceId,
      sourceName: nameOf(item.sourceId),
      part: item.part ? partLabel(item.part) : null,
      itemId: item.itemId,
      title: (item.title ?? "").trim() || "Без названия",
      brand: row?.brand?.trim() || item.brand?.trim() || nameOf(item.sourceId),
      image,
      productUrl: catalogProductUrl(row?.handle ?? null, source?.seedUrl ?? null),
      referenceId: row?.reference_id ?? null,
      referenceStatus: row?.reference_id ? statuses.get(row.reference_id) ?? null : null,
      findingHref: row?.reference_id ? `${ASSORTMENT_BASE_PATH}/${direction}/${row.reference_id}` : null,
      inCatalog: Boolean(row),
      seenOn: item.seenOn,
      absentOn: item.absentOn,
      mass: item.mass,
      staleSpanDays: item.staleSpanDays,
    };
    groups[KIND_GROUP[item.kind]].push(card);
    const key = streamKey(item.sourceId, item.part);
    const counts = perStream.get(key) ?? { appeared: 0, disappeared: 0, firstInWindow: 0 };
    counts[KIND_GROUP[item.kind]] += 1;
    perStream.set(key, counts);
  }
  const totals = { appeared: groups.appeared.length, disappeared: groups.disappeared.length, firstInWindow: groups.firstInWindow.length, hidden };
  for (const list of Object.values(groups) as ChangeCard[][]) list.sort(byOrder);

  const sources: ChangesSourceView[] = computed.streams
    // Модели раздела у источника нет вовсе — в этом разделе источника нет.
    .filter((s) => s.models !== 0)
    .map((s) => {
      const counts = perStream.get(streamKey(s.sourceId, s.part)) ?? { appeared: 0, disappeared: 0, firstInWindow: 0 };
      return {
        sourceId: s.sourceId, name: nameOf(s.sourceId), kind: s.kind, part: s.part ? partLabel(s.part) : null, status: s.status,
        historyStatus: historyOf.get(s.sourceId) ?? null, readyOn: s.readyOn, disappearReady: s.disappearReady, disappearRunsMissing: s.disappearRunsMissing,
        latestOn: s.latestOn, baseOn: s.baseOn, recentOn: s.recentOn, ...counts, mass: s.mass, spanDays: s.spanDays, baseStale: s.baseStale,
      };
    })
    .sort((a, b) => Number(a.status !== "ready") - Number(b.status !== "ready") || a.name.localeCompare(b.name, "ru") || (a.part ?? "").localeCompare(b.part ?? "", "ru"));

  return {
    available: true,
    direction,
    today: ctx.today,
    periodDays,
    periodStart: plan.periodStart,
    disappearRuns: DISAPPEAR_FULL_RUNS,
    season: seasonCaption(ctx.today),
    groups: { appeared: groups.appeared.slice(0, CHANGES_GROUP_LIMIT), disappeared: groups.disappeared.slice(0, CHANGES_GROUP_LIMIT), firstInWindow: groups.firstInWindow.slice(0, CHANGES_GROUP_LIMIT) },
    totals,
    sources,
    tabVisible: changesTabVisible(histories),
  };
}

/** Вкладка «Изменения» раздела за период (неделя по умолчанию). */
export async function loadChanges(db: SupabaseClient, options: { direction: AssortmentDirection; periodDays: ChangesPeriod; now?: Date | number; mark?: (name: string) => void }): Promise<ChangesResult> {
  const ctx = await loadContext(db, options.now ?? new Date());
  options.mark?.("runs");
  if (!ctx) return { available: false, reason: CHANGES_UNAVAILABLE };
  try {
    return await buildDirection(db, ctx, options.direction, options.periodDays, options.mark);
  } catch (error) {
    if (tableMissing(error)) return { available: false, reason: CHANGES_UNAVAILABLE };
    throw error;
  }
}

/** Есть ли вкладка: только журнал прогонов (снимки не читаются) — хотя бы у одного полного источника «появилось/пропало» уже наблюдение. */
export async function loadChangesTab(db: SupabaseClient, direction: AssortmentDirection, now: Date | number = new Date()): Promise<{ available: boolean; visible: boolean }> {
  const ctx = await loadContext(db, now);
  if (!ctx) return { available: false, visible: false };
  return { available: true, visible: changesTabVisible(summarizeHistory(sectionRuns(ctx, direction), ctx.today)) };
}

// ---------------------------------------------------------------------------
// Воскресная сводка

export interface DigestChangesSource {
  name: string;
  appeared: number;
  disappeared: number;
  firstInWindow: number;
  /** Прогон на начало периода и последний прогон — даты, между которыми сравнивали. */
  fromOn: string | null;
  toOn: string | null;
  mass: boolean;
  /** База устарела (сборщик простаивал): сравнение за столько дней, а не за период; null — база в порядке. */
  staleSpanDays?: number | null;
}

export interface DigestChangesDirection {
  /** Источники с изменениями, больше изменений — выше. */
  sources: DigestChangesSource[];
  /** Готовые источники без изменений за период. */
  quiet: string[];
  /** До трёх появившихся моделей («бренд · название»), кроме массовых смен. */
  examples: string[];
}

export interface DigestChangesBlock {
  periodDays: number;
  periodStart: string;
  today: string;
  /** null — в разделе ни один источник ещё не готов. */
  directions: Record<AssortmentDirection, DigestChangesDirection | null>;
}

export interface DigestChanges {
  /** null — раздел не посчитался (см. error). */
  week: DigestChangesBlock | null;
  /** Месячная выжимка — только в первое воскресенье месяца. */
  month: DigestChangesBlock | null;
  season: string | null;
  disappearRuns: number;
  /** Раздел не посчитался: строка в сводке, а не молчание. */
  error?: string;
}

function digestDirection(result: Ready): DigestChangesDirection | null {
  const ready = result.sources.filter((s) => s.status === "ready");
  if (ready.length === 0) return null;
  const label = (s: ChangesSourceView) => (s.part ? `${s.name} (${s.part})` : s.name);
  const changed = ready.filter((s) => s.appeared + s.disappeared + s.firstInWindow > 0)
    .sort((a, b) => (b.appeared + b.disappeared + b.firstInWindow) - (a.appeared + a.disappeared + a.firstInWindow) || a.name.localeCompare(b.name, "ru"));
  return {
    sources: changed.map((s) => ({
      name: label(s), appeared: s.appeared, disappeared: s.disappeared, firstInWindow: s.firstInWindow, fromOn: s.baseOn[0] ?? null, toOn: s.latestOn, mass: s.mass,
      staleSpanDays: s.baseStale ? s.spanDays : null,
    })),
    quiet: ready.filter((s) => s.appeared + s.disappeared + s.firstInWindow === 0).map(label),
    examples: result.groups.appeared.filter((c) => !c.mass).slice(0, 3).map((c) => (c.title.toLowerCase().includes(c.brand.toLowerCase()) ? c.title : `${c.brand} · ${c.title}`)),
  };
}

async function digestBlock(db: SupabaseClient, ctx: Context, periodDays: number): Promise<DigestChangesBlock> {
  const directions = {} as Record<AssortmentDirection, DigestChangesDirection | null>;
  let periodStart = "";
  for (const direction of ASSORTMENT_DIRECTIONS) {
    const result = await buildDirection(db, ctx, direction, periodDays);
    periodStart = result.periodStart;
    directions[direction] = digestDirection(result);
  }
  return { periodDays, periodStart, today: ctx.today, directions };
}

/**
 * Раздел «Появилось / пропало» воскресной сводки: за неделю, а в первое воскресенье месяца — ещё и за месяц. null — журнала нет или
 * ни один источник ещё не готов (тогда сводка говорит об истории своим разделом «История каталогов»).
 */
export async function loadDigestChanges(db: SupabaseClient, now: Date | number): Promise<DigestChanges | null> {
  const ctx = await loadContext(db, now);
  if (!ctx) return null;
  const week = await digestBlock(db, ctx, 7);
  const month = isFirstSundayOfMonth(ctx.today) ? await digestBlock(db, ctx, MONTH_PERIOD_DAYS) : null;
  const anyReady = [week, month].some((b) => b && Object.values(b.directions).some(Boolean));
  if (!anyReady) return null;
  return { week, month, season: seasonCaption(ctx.today), disappearRuns: DISAPPEAR_FULL_RUNS };
}
