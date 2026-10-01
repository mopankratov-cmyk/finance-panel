import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssortmentDirection } from "./constants";
import { isReferenceStatus, STATUS_LABEL } from "./decisions";
import { cardSignal, type CardSignal, type ObservationLite } from "./signals";
import { signedUrls } from "./storage";

export type FeedView = "new" | "retail" | "hidden";

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
}

type Observation = ObservationLite & { reference_id: string; method: string };

const HIDDEN_STATUSES = ["rejected", "archived"];

export async function loadFeed(db: SupabaseClient, direction: AssortmentDirection, view: FeedView, limit = 60): Promise<FeedCard[]> {
  let query = db
    .from("assortment_references")
    .select("id,title,brand,region,url,first_seen_at,status,version,attributes,source_id")
    .eq("direction", direction);
  query = view === "hidden"
    ? query.in("status", HIDDEN_STATUSES)
    : query.not("status", "in", `(${HIDDEN_STATUSES.join(",")})`);
  const { data: refs, error } = await query
    .order("first_seen_at", { ascending: false })
    .limit(view === "retail" ? 300 : limit);
  if (error) throw new Error(error.message);
  const rows = refs ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => String(r.id));

  const [{ data: observations }, { data: media }] = await Promise.all([
    db.from("assortment_observations")
      .select("reference_id,group_kind,metric,value_text,value_num,null_reason,status,method,observed_at")
      .in("reference_id", ids),
    db.from("assortment_media")
      .select("reference_id,storage_path,position")
      .in("reference_id", ids)
      .order("position", { ascending: true }),
  ]);

  const byRef = new Map<string, Observation[]>();
  for (const o of (observations ?? []) as Observation[]) {
    const list = byRef.get(o.reference_id) ?? [];
    list.push(o);
    byRef.set(o.reference_id, list);
  }
  const cover = new Map<string, string>();
  for (const m of media ?? []) {
    const id = String(m.reference_id);
    if (!cover.has(id) && m.storage_path) cover.set(id, String(m.storage_path));
  }
  const urls = await signedUrls(db, [...cover.values()]);

  const cards = rows.map((row): FeedCard => {
    const id = String(row.id);
    const obs = byRef.get(id) ?? [];
    const attributes = (row.attributes ?? {}) as Record<string, { value?: unknown }>;
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
    };
  });
  const filtered = view === "retail" ? cards.filter((c) => c.signal.tone === "retail") : cards;
  return filtered.slice(0, limit);
}
