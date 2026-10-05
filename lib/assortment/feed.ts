import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { AssortmentDirection } from "./constants";
import { isReferenceStatus, STATUS_LABEL } from "./decisions";
import { formatValue, type Attributes } from "./attributes";
import { lessonFor } from "./learning";
import { loadLearning } from "./learningStore";
import { RU_SOURCE_IDS } from "./ruMarket";
import { cardSignal, type CardSignal, type ObservationLite } from "./signals";
import { signedUrls } from "./storage";

export type FeedView = "new" | "retail" | "hidden" | "ru" | "work";

export interface FeedCard {
  id: string;
  title: string;
  brand: string | null;
  region: string;
  url: string;
  firstSeenAt: string;
  status: string;
  statusLabel: string;
  version: number;
  coverUrl: string | null;
  colors: number;
  signal: CardSignal;
  lesson: string | null;
}

type Observation = ObservationLite & { reference_id: string; method: string };

const HIDDEN_STATUSES = ["rejected", "archived"];
/** «В работе»: отобранные, ждущие образца и уже в подборке — в «Новинках» их нет. */
const WORK_STATUSES = ["selected", "sample_needed", "in_collection"];

/** Сколько находок в одном запросе `.in()`: сотни uuid в адресе — это килобайты URL, шлюз может отказать. */
const REF_CHUNK = 100;
/** «Рынок РФ»: вкладка сортируется по продажам, поэтому сортировать надо ВЕСЬ замер (≈220 позиций), а не 60 самых новых. */
const RU_POOL = 400;

/** Строки таблицы по списку находок: пачками по REF_CHUNK и с листанием (предел PostgREST — 1000 строк); сбой чтения — исключение, а не «данных нет». */
async function rowsByReferences<Row>(ids: string[], label: string, fetchPage: (part: string[], from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += REF_CHUNK) parts.push(ids.slice(i, i + REF_CHUNK));
  const loaded = await Promise.all(parts.map((part) => loadAllSupabasePages<Row>((from, to) => fetchPage(part, from, to), { label, pageSize: 1000 })));
  return loaded.flat();
}

export async function loadFeed(db: SupabaseClient, direction: AssortmentDirection, view: FeedView, limit = 60): Promise<FeedCard[]> {
  let query = db
    .from("assortment_references")
    .select("id,title,brand,region,url,first_seen_at,status,version,attributes,source_id")
    .eq("direction", direction);
  if (view === "hidden") query = query.in("status", HIDDEN_STATUSES);
  else if (view === "work") query = query.in("status", WORK_STATUSES);
  else if (view === "new") query = query.not("status", "in", `(${[...HIDDEN_STATUSES, ...WORK_STATUSES].join(",")})`);
  else query = query.not("status", "in", `(${HIDDEN_STATUSES.join(",")})`);
  // «Рынок РФ» — отдельная вкладка: топ WB и Lime не смешиваем с зарубежными находками.
  if (view === "ru") query = query.in("source_id", RU_SOURCE_IDS);
  else if (view !== "hidden" && view !== "work") query = query.or(`source_id.is.null,source_id.not.in.(${RU_SOURCE_IDS.join(",")})`);
  const { data: refs, error } = await query
    // «В работе» — по последнему решению, остальное — по дате находки.
    .order(view === "work" ? "updated_at" : "first_seen_at", { ascending: false })
    .limit(view === "retail" ? 300 : view === "ru" ? RU_POOL : limit);
  if (error) throw new Error(error.message);
  const rows = refs ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => String(r.id));

  // Сбой чтения наблюдений или фото — ошибка, а не «наблюдений нет»: иначе карточки подписывались бы «Пока одна находка», а вкладка «Ритейл» была бы пустой.
  const [observations, media, learning] = await Promise.all([
    rowsByReferences<Observation>(ids, "Наблюдения находок", (part, from, to) => db.from("assortment_observations")
      .select("reference_id,group_kind,metric,value_text,value_num,null_reason,status,method,observed_at")
      .in("reference_id", part)
      .order("reference_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Observation[] | null; error: { message: string } | null }>),
    rowsByReferences<{ reference_id: string; storage_path: string | null; position: number | null }>(ids, "Фото находок", (part, from, to) => db.from("assortment_media")
      .select("reference_id,storage_path,position")
      .in("reference_id", part)
      .order("reference_id", { ascending: true })
      .order("position", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Array<{ reference_id: string; storage_path: string | null; position: number | null }> | null; error: { message: string } | null }>),
    view === "hidden" ? Promise.resolve(null) : loadLearning(db, direction),
  ]);

  const byRef = new Map<string, Observation[]>();
  for (const o of observations) {
    const list = byRef.get(o.reference_id) ?? [];
    list.push(o);
    byRef.set(o.reference_id, list);
  }
  const cover = new Map<string, string>();
  for (const m of media) {
    const id = String(m.reference_id);
    if (!cover.has(id) && m.storage_path) cover.set(id, String(m.storage_path));
  }
  const urls = await signedUrls(db, [...cover.values()]);

  const cards = rows.map((row): FeedCard => {
    const id = String(row.id);
    const obs = byRef.get(id) ?? [];
    const attributes = (row.attributes ?? {}) as Attributes;
    const colors = Array.isArray(attributes.colors?.value) ? attributes.colors.value.length : 0;
    const manual = obs.some((o) => o.metric === "first_seen" && o.method === "import_manual") || !row.source_id;
    const path = cover.get(id);
    return {
      id,
      title: String(row.title ?? ""),
      brand: row.brand ? String(row.brand) : null,
      region: String(row.region ?? ""),
      url: String(row.url ?? ""),
      firstSeenAt: String(row.first_seen_at),
      status: String(row.status),
      statusLabel: isReferenceStatus(row.status) ? STATUS_LABEL[row.status] : String(row.status),
      version: Number(row.version ?? 1),
      coverUrl: path ? urls.get(path) ?? null : null,
      colors,
      signal: cardSignal(obs, { manual, colors }),
      lesson: learning
        ? lessonFor({
          referenceId: id,
          direction,
          brand: row.brand ? String(row.brand) : null,
          title: row.title ? String(row.title) : null,
          attributes: Object.fromEntries(Object.entries(attributes).map(([key, entry]) => [key, formatValue(entry)])),
        }, learning.lessons, learning.ownIds)?.note ?? null
        : null,
    };
  });
  const filtered = view === "retail" ? cards.filter((c) => c.signal.tone === "retail") : cards;
  if (view === "ru") {
    // Рынок РФ — по продажам, а не по дате: первым то, что больше продаётся.
    const sales = (id: string) => (byRef.get(id) ?? [])
      .filter((o) => o.metric === "wb_sales_30d" && o.value_num != null)
      .sort((a, b) => b.observed_at.localeCompare(a.observed_at))[0]?.value_num ?? 0;
    filtered.sort((a, b) => sales(b.id) - sales(a.id));
  }
  return filtered.slice(0, limit);
}
