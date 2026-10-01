import type { SupabaseClient } from "@supabase/supabase-js";
import { fieldsFor, formatValue, type Attributes } from "./attributes";
import {
  CollectionInputError,
  defaultTitle,
  EMPTY_BRIEF,
  isValidPeriod,
  itemPosition,
  placementFor,
  planProgress,
  sameConstruction,
  type BriefSnapshot,
  type CollectionKind,
  type CollectionStatus,
  type ItemBrief,
  type ItemPatch,
  type PlanItemLite,
  type PlanProgress,
  type ReplaceReason,
} from "./collections";
import type { AssortmentDirection } from "./constants";
import { isReferenceStatus, type ReferenceStatus } from "./decisions";
import { isMissingColumnError } from "./errors";
import { buildEvidence, type EvidenceObservation } from "./evidence";
import { assembleDraft, lessonFor, type DraftResult } from "./learning";
import { loadLearning } from "./learningStore";
import { cardSignal, type CardSignal } from "./signals";
import { signedUrls } from "./storage";

export class CollectionNotFoundError extends Error {
  constructor() {
    super("Подборка не найдена");
  }
}

export interface CollectionSummary {
  id: string;
  direction: AssortmentDirection;
  kind: CollectionKind;
  title: string;
  period: string | null;
  status: CollectionStatus;
  version: number;
  responsible: string | null;
  progress: PlanProgress;
  updatedAt: string;
}

export interface CollectionItemView {
  id: string;
  referenceId: string;
  slot: number | null;
  isReserve: boolean;
  idea: string | null;
  details: string[];
  nextStep: string | null;
  brief: ItemBrief;
  title: string;
  brand: string | null;
  article: string | null;
  url: string;
  coverUrl: string | null;
  attributes: Record<string, string | null>;
  duplicateOf: string | null;
}

export interface CollectionDetail extends CollectionSummary {
  items: CollectionItemView[];
  briefSupported: boolean;
  versions: Array<{ version: number; savedAt: string; author: string | null }>;
  dirty: boolean;
}

const COLLECTION_COLUMNS = "id,direction,kind,title,period,status,version,created_at,updated_at";

type CollectionRow = {
  id: string;
  direction: AssortmentDirection;
  kind: CollectionKind;
  title: string;
  period: string | null;
  status: CollectionStatus;
  version: number;
  updated_at: string;
  responsible?: string | null;
};

/** Колонка responsible приходит миграцией 202610020001 — без неё читаем без неё. */
async function readCollections(db: SupabaseClient, id?: string): Promise<{ rows: CollectionRow[]; briefSupported: boolean }> {
  const run = async (columns: string) => {
    let query = db.from("assortment_collections").select(columns);
    if (id) query = query.eq("id", id);
    return query.order("updated_at", { ascending: false }).limit(200);
  };
  const full = await run(`${COLLECTION_COLUMNS},responsible`);
  if (!full.error) return { rows: (full.data ?? []) as unknown as CollectionRow[], briefSupported: true };
  if (!isMissingColumnError(full.error)) throw new Error(full.error.message);
  const legacy = await run(COLLECTION_COLUMNS);
  if (legacy.error) throw new Error(legacy.error.message);
  return { rows: (legacy.data ?? []) as unknown as CollectionRow[], briefSupported: false };
}

type ItemRow = {
  id: string;
  collection_id: string;
  reference_id: string;
  slot: number | null;
  is_reserve: boolean;
  idea: string | null;
  details: string[] | null;
  next_step: string | null;
  brief?: Partial<ItemBrief> | null;
};

const ITEM_COLUMNS = "id,collection_id,reference_id,slot,is_reserve,idea,details,next_step,created_at";

async function readItems(db: SupabaseClient, collectionIds: string[]): Promise<{ rows: ItemRow[]; briefSupported: boolean }> {
  if (collectionIds.length === 0) return { rows: [], briefSupported: true };
  const run = (columns: string) => db.from("assortment_collection_items").select(columns).in("collection_id", collectionIds).order("created_at", { ascending: true });
  const full = await run(`${ITEM_COLUMNS},brief`);
  if (!full.error) return { rows: (full.data ?? []) as unknown as ItemRow[], briefSupported: true };
  if (!isMissingColumnError(full.error)) throw new Error(full.error.message);
  const legacy = await run(ITEM_COLUMNS);
  if (legacy.error) throw new Error(legacy.error.message);
  return { rows: (legacy.data ?? []) as unknown as ItemRow[], briefSupported: false };
}

type RefLite = { id: string; direction: AssortmentDirection; title: string | null; brand: string | null; article: string | null; url: string | null; status: string; version: number; attributes: Attributes | null; source_id: string | null };

async function readRefs(db: SupabaseClient, ids: string[]): Promise<Map<string, RefLite>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db.from("assortment_references")
    .select("id,direction,title,brand,article,url,status,version,attributes,source_id")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as RefLite[]).map((r) => [String(r.id), r]));
}

async function covers(db: SupabaseClient, ids: string[], perRef = 1): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const { data } = await db.from("assortment_media").select("reference_id,storage_path,position").in("reference_id", ids).order("position", { ascending: true });
  const paths = new Map<string, string[]>();
  for (const m of data ?? []) {
    const list = paths.get(String(m.reference_id)) ?? [];
    if (list.length < perRef && m.storage_path) list.push(String(m.storage_path));
    paths.set(String(m.reference_id), list);
  }
  const urls = await signedUrls(db, [...paths.values()].flat());
  return new Map([...paths.entries()].map(([id, list]) => [id, list.map((p) => urls.get(p)).filter((u): u is string => Boolean(u))]));
}

const attributeMap = (attributes: Attributes | null): Record<string, string | null> => {
  const out: Record<string, string | null> = {};
  for (const [key, entry] of Object.entries(attributes ?? {})) out[key] = formatValue(entry);
  return out;
};

const lite = (item: ItemRow, ref: RefLite | undefined): PlanItemLite => ({
  id: item.id,
  referenceId: item.reference_id,
  slot: item.slot,
  isReserve: item.is_reserve,
  brand: ref?.brand ?? null,
  title: ref?.title ?? null,
});

export async function listCollections(db: SupabaseClient): Promise<CollectionSummary[]> {
  const { rows } = await readCollections(db);
  const { rows: items } = await readItems(db, rows.map((r) => r.id));
  return rows.map((row) => {
    const own = items.filter((i) => i.collection_id === row.id);
    return {
      id: row.id,
      direction: row.direction,
      kind: row.kind,
      title: row.title,
      period: row.period,
      status: row.status,
      version: row.version,
      responsible: row.responsible ?? null,
      progress: planProgress(row.kind, own.map((i) => lite(i, undefined))),
      updatedAt: row.updated_at,
    };
  });
}

export async function createCollection(
  db: SupabaseClient,
  input: { direction: AssortmentDirection; kind: CollectionKind; period: string; title?: string | null; responsible?: string | null },
  actor: string,
): Promise<{ id: string; created: boolean }> {
  if (!isValidPeriod(input.kind, input.period)) throw new CollectionInputError("Период подборки указан неверно.");
  if (input.kind === "bags_month" && input.direction !== "bags") throw new CollectionInputError("План на месяц — для сумок.");
  if (input.kind === "jackets_season" && input.direction !== "jackets") throw new CollectionInputError("Сезонная доска — для курток.");
  if (input.kind !== "custom") {
    const { data: existing } = await db.from("assortment_collections").select("id")
      .eq("direction", input.direction).eq("kind", input.kind).eq("period", input.period).neq("status", "archived").limit(1);
    if (existing && existing.length > 0) return { id: String(existing[0].id), created: false };
  }
  const row: Record<string, unknown> = {
    direction: input.direction,
    kind: input.kind,
    period: input.period,
    title: input.title?.trim() || defaultTitle(input.direction, input.period),
    created_by: actor,
  };
  if (input.responsible) row.responsible = input.responsible;
  let result = await db.from("assortment_collections").insert(row).select("id").single();
  if (result.error && isMissingColumnError(result.error) && "responsible" in row) {
    delete row.responsible;
    result = await db.from("assortment_collections").insert(row).select("id").single();
  }
  if (result.error || !result.data) throw new Error(result.error?.message ?? "Подборка не создалась");
  return { id: String(result.data.id), created: true };
}

async function lastSaved(db: SupabaseClient, collectionId: string) {
  const { data, error } = await db.from("assortment_decisions")
    .select("version,created_at,author,brief")
    .eq("collection_id", collectionId)
    .is("reference_id", null)
    .order("version", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ version: number; created_at: string; author: string | null; brief: BriefSnapshot | null }>;
}

export async function loadCollection(db: SupabaseClient, id: string): Promise<CollectionDetail> {
  const { rows, briefSupported: collectionBrief } = await readCollections(db, id);
  const row = rows[0];
  if (!row) throw new CollectionNotFoundError();
  const { rows: items, briefSupported: itemBrief } = await readItems(db, [id]);
  const refIds = items.map((i) => i.reference_id);
  const [refs, photos, saved] = await Promise.all([readRefs(db, refIds), covers(db, refIds), lastSaved(db, id)]);
  const lites = items.map((i) => lite(i, refs.get(i.reference_id)));

  const views = items.map((item): CollectionItemView => {
    const ref = refs.get(item.reference_id);
    const duplicate = ref ? sameConstruction(lites, { brand: ref.brand, title: ref.title, referenceId: item.reference_id }) : null;
    return {
      id: item.id,
      referenceId: item.reference_id,
      slot: item.slot,
      isReserve: item.is_reserve,
      idea: item.idea,
      details: item.details ?? [],
      nextStep: item.next_step,
      brief: { ...EMPTY_BRIEF, ...(item.brief ?? {}) },
      title: ref?.title ?? "Модель удалена",
      brand: ref?.brand ?? null,
      article: ref?.article ?? null,
      url: ref?.url ?? "",
      coverUrl: photos.get(item.reference_id)?.[0] ?? null,
      attributes: attributeMap(ref?.attributes ?? null),
      duplicateOf: duplicate ? duplicate.title ?? null : null,
    };
  });
  const latest = saved[0];
  return {
    id: row.id,
    direction: row.direction,
    kind: row.kind,
    title: row.title,
    period: row.period,
    status: row.status,
    version: row.version,
    responsible: row.responsible ?? null,
    progress: planProgress(row.kind, lites),
    updatedAt: row.updated_at,
    items: views,
    briefSupported: collectionBrief && itemBrief,
    versions: saved.map((s) => ({ version: s.version, savedAt: s.created_at, author: s.author })),
    // Сохранение пишет updated_at = savedAt снимка — сравниваем часы одного источника.
    dirty: !latest || new Date(row.updated_at).getTime() > new Date(latest.brief?.collection.savedAt ?? latest.created_at).getTime(),
  };
}

async function touchCollection(db: SupabaseClient, id: string, patch: Record<string, unknown> = {}) {
  const { error } = await db.from("assortment_collections").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Статус модели вслед за подборкой, с шагом версии и записью решения. */
async function moveReference(
  db: SupabaseClient,
  refId: string,
  status: ReferenceStatus,
  decision: { kind: "to_collection" | "postponed"; collectionId: string; reason: string | null; author: string },
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: ref } = await db.from("assortment_references").select("version,status").eq("id", refId).maybeSingle();
    if (!ref) return;
    if (ref.status === status) return;
    const version = Number(ref.version) + 1;
    const { data: updated } = await db.from("assortment_references")
      .update({ status, version, updated_at: new Date().toISOString() })
      .eq("id", refId).eq("version", ref.version).select("id");
    if (updated && updated.length > 0) {
      await db.from("assortment_decisions").insert({
        reference_id: refId,
        collection_id: decision.collectionId,
        decision: decision.kind,
        reason: decision.reason,
        version,
        author: decision.author,
      });
      return;
    }
  }
}

async function readCollectionRow(db: SupabaseClient, id: string): Promise<CollectionRow> {
  const { rows } = await readCollections(db, id);
  if (!rows[0]) throw new CollectionNotFoundError();
  return rows[0];
}

export async function addItem(db: SupabaseClient, collectionId: string, referenceId: string, asReserve: boolean, actor: string, preferredSlot: number | null = null): Promise<void> {
  const collection = await readCollectionRow(db, collectionId);
  if (collection.status === "archived") throw new CollectionInputError("Подборка в архиве — сначала верните её.");
  const refs = await readRefs(db, [referenceId]);
  const ref = refs.get(referenceId);
  if (!ref) throw new CollectionInputError("Модель не найдена.");
  if (ref.direction !== collection.direction) throw new CollectionInputError("Модель из другого раздела.");
  if (ref.status === "rejected" || ref.status === "archived") throw new CollectionInputError("Модель отклонена или скрыта — сначала верните её в ленту.");
  const { rows: items } = await readItems(db, [collectionId]);
  if (items.some((i) => i.reference_id === referenceId)) throw new CollectionInputError("Эта модель уже в подборке.");
  const itemRefs = await readRefs(db, items.map((i) => i.reference_id));
  const place = placementFor(collection.kind, items.map((i) => lite(i, itemRefs.get(i.reference_id))), asReserve, preferredSlot);
  if (!place) throw new CollectionInputError("Все пять мест и три резерва заняты — замените кого-то.");
  const { error } = await db.from("assortment_collection_items").insert({
    collection_id: collectionId,
    reference_id: referenceId,
    slot: place.slot,
    is_reserve: place.isReserve,
  });
  if (error) throw new Error(error.message);
  await touchCollection(db, collectionId);
  await moveReference(db, referenceId, "in_collection", { kind: "to_collection", collectionId, reason: null, author: actor });
}

async function readItem(db: SupabaseClient, collectionId: string, itemId: string): Promise<ItemRow> {
  const { data, error } = await db.from("assortment_collection_items").select(ITEM_COLUMNS).eq("id", itemId).eq("collection_id", collectionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new CollectionInputError("Кандидат не найден в подборке.");
  return data as unknown as ItemRow;
}

export async function updateItem(db: SupabaseClient, collectionId: string, itemId: string, patch: ItemPatch & { moveTo?: "main" | "reserve" }): Promise<void> {
  const collection = await readCollectionRow(db, collectionId);
  await readItem(db, collectionId, itemId);
  const update: Record<string, unknown> = {};
  if (patch.idea !== undefined) update.idea = patch.idea;
  if (patch.details !== undefined) update.details = patch.details;
  if (patch.nextStep !== undefined) update.next_step = patch.nextStep;
  if (patch.brief !== undefined) update.brief = patch.brief;
  if (patch.moveTo) {
    const { rows: items } = await readItems(db, [collectionId]);
    const others = items.filter((i) => i.id !== itemId).map((i) => lite(i, undefined));
    const place = placementFor(collection.kind, others, patch.moveTo === "reserve");
    if (!place || place.isReserve !== (patch.moveTo === "reserve")) {
      throw new CollectionInputError(patch.moveTo === "main" ? "Свободных мест среди пяти нет." : "Резерв уже из трёх моделей.");
    }
    update.slot = place.slot;
    update.is_reserve = place.isReserve;
  }
  if (Object.keys(update).length === 0) return;
  const { error } = await db.from("assortment_collection_items").update(update).eq("id", itemId);
  if (error) {
    if (isMissingColumnError(error) && "brief" in update) throw new CollectionInputError("Поля задания появятся после миграции 202610020001.");
    throw new Error(error.message);
  }
  await touchCollection(db, collectionId);
}

/** Убрать кандидата. Причина замены пишется в решение — по ней учимся. */
export async function removeItem(db: SupabaseClient, collectionId: string, itemId: string, reason: ReplaceReason | null, actor: string): Promise<void> {
  const item = await readItem(db, collectionId, itemId);
  const { error } = await db.from("assortment_collection_items").delete().eq("id", itemId);
  if (error) throw new Error(error.message);
  await touchCollection(db, collectionId);
  const { data: elsewhere } = await db.from("assortment_collection_items").select("id").eq("reference_id", item.reference_id).limit(1);
  if (!elsewhere || elsewhere.length === 0) {
    await moveReference(db, item.reference_id, "watching", {
      kind: "postponed",
      collectionId,
      reason: reason ? `replaced:${reason}` : "убрана из подборки",
      author: actor,
    });
  }
}

export async function updateCollectionMeta(db: SupabaseClient, id: string, patch: { title?: string; responsible?: string | null; status?: CollectionStatus }): Promise<void> {
  await readCollectionRow(db, id);
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.responsible !== undefined) update.responsible = patch.responsible;
  if (patch.status !== undefined) update.status = patch.status;
  const { error } = await db.from("assortment_collections").update({ ...update, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) {
    if (isMissingColumnError(error)) throw new CollectionInputError("Поле «Ответственный» появится после миграции 202610020001.");
    throw new Error(error.message);
  }
}

async function evidenceFor(db: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return new Map<string, EvidenceObservation[]>();
  const { data, error } = await db.from("assortment_observations")
    .select("reference_id,group_kind,metric,value_text,value_num,null_reason,status,method,region,source_url,observed_at")
    .in("reference_id", ids);
  if (error) throw new Error(error.message);
  const map = new Map<string, EvidenceObservation[]>();
  for (const o of (data ?? []) as Array<EvidenceObservation & { reference_id: string }>) {
    map.set(o.reference_id, [...(map.get(o.reference_id) ?? []), o]);
  }
  return map;
}

/** Сохранить версию: снимок становится основой экспорта (ТЗ §8). */
export async function saveVersion(db: SupabaseClient, id: string, expectedVersion: number, actor: string): Promise<number> {
  const detail = await loadCollection(db, id);
  if (detail.version !== expectedVersion) throw new CollectionInputError("Подборку только что изменили — обновите страницу.");
  if (detail.items.length === 0) throw new CollectionInputError("В подборке нет ни одной модели.");
  const refs = await readRefs(db, detail.items.map((i) => i.referenceId));
  const evidence = await evidenceFor(db, detail.items.map((i) => i.referenceId));
  const version = expectedVersion + 1;
  const savedAt = new Date().toISOString();
  let reserveIndex = 0;
  let mainIndex = 0;
  const ordered = [...detail.items].sort((a, b) => Number(a.isReserve) - Number(b.isReserve) || (a.slot ?? 99) - (b.slot ?? 99));
  const snapshot: BriefSnapshot = {
    collection: { id, title: detail.title, direction: detail.direction, kind: detail.kind, period: detail.period, responsible: detail.responsible, version, savedAt, savedBy: actor },
    items: ordered.map((item) => {
      const groups = buildEvidence(evidence.get(item.referenceId) ?? []);
      const rows = [...groups.novelty, ...groups.spread, ...groups.retail];
      const ref = refs.get(item.referenceId);
      const attributes = fieldsFor(detail.direction)
        .filter((f) => f.key !== "note")
        .map((f) => ({ label: f.label, value: formatValue(ref?.attributes?.[f.key]) }))
        .filter((a): a is { label: string; value: string } => Boolean(a.value));
      return {
        referenceId: item.referenceId,
        position: itemPosition(item.slot, item.isReserve, item.isReserve ? ++reserveIndex : ++mainIndex),
        title: item.title,
        brand: item.brand,
        article: item.article,
        sourceUrl: item.url,
        idea: item.idea,
        details: item.details,
        differences: item.brief.differences,
        questions: item.brief.questions,
        seasonFit: item.brief.season_fit,
        nextStep: item.nextStep,
        observed: rows.filter((r) => !r.missing).map((r) => `${r.label}: ${r.value}`),
        missing: rows.filter((r) => r.missing).map((r) => `${r.label} — ${r.detail}`),
        attributes,
      };
    }),
  };
  const { data: updated, error } = await db.from("assortment_collections")
    .update({ status: "saved", version, updated_at: savedAt })
    .eq("id", id).eq("version", expectedVersion).select("id");
  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) throw new CollectionInputError("Подборку только что изменили — обновите страницу.");
  const { error: decisionError } = await db.from("assortment_decisions").insert({
    collection_id: id,
    decision: "selected",
    reason: null,
    version,
    brief: snapshot,
    author: actor,
  });
  if (decisionError) throw new Error(decisionError.message);
  return version;
}

export interface BriefView extends BriefSnapshot {
  photos: Record<string, string[]>;
}

/** Снимок версии (по умолчанию последней) и свежие ссылки на фото для печати. */
export async function loadBrief(db: SupabaseClient, id: string, version: number | null, withPhotos: boolean): Promise<BriefView> {
  await readCollectionRow(db, id);
  const saved = await lastSaved(db, id);
  const chosen = version ? saved.find((s) => s.version === version) : saved[0];
  if (!chosen?.brief) throw new CollectionInputError("Сохранённой версии нет — сначала нажмите «Сохранить версию».");
  const snapshot = chosen.brief;
  const photos = withPhotos ? await covers(db, snapshot.items.map((i) => i.referenceId), 3) : new Map<string, string[]>();
  return { ...snapshot, photos: Object.fromEntries(photos) };
}

export interface CandidateCard {
  id: string;
  title: string;
  brand: string | null;
  status: ReferenceStatus;
  coverUrl: string | null;
  signal: CardSignal;
  duplicateOf: string | null;
  lesson: string | null;
  attributes: Record<string, string | null>;
  score: number;
}

const TONE_SCORE: Record<CardSignal["tone"], number> = { retail: 3, novelty: 2, manual: 1, single: 1 };
const STATUS_SCORE: Partial<Record<ReferenceStatus, number>> = { selected: 2, sample_needed: 2, watching: 0.5 };

/** Кандидаты в подборку: раздел тот же, не отклонены, ещё не в ней. */
export async function loadCandidates(db: SupabaseClient, collectionId: string): Promise<CandidateCard[]> {
  const collection = await readCollectionRow(db, collectionId);
  const { rows: items } = await readItems(db, [collectionId]);
  const inside = new Set(items.map((i) => i.reference_id));
  const itemRefs = await readRefs(db, [...inside]);
  const lites = items.map((i) => lite(i, itemRefs.get(i.reference_id)));
  const { data, error } = await db.from("assortment_references")
    .select("id,title,brand,status,attributes,source_id")
    .eq("direction", collection.direction)
    .not("status", "in", "(rejected,archived)")
    .order("first_seen_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const refs = (data ?? []).filter((r) => !inside.has(String(r.id)));
  const ids = refs.map((r) => String(r.id));
  const [photos, evidence, learning] = await Promise.all([covers(db, ids), evidenceFor(db, ids), loadLearning(db, collection.direction)]);
  return refs.map((r) => {
    const id = String(r.id);
    const obs = evidence.get(id) ?? [];
    const attributes = (r.attributes ?? {}) as Attributes;
    const colors = Array.isArray(attributes.colors?.value) ? attributes.colors.value.length : 0;
    const manual = !r.source_id || obs.some((o) => o.metric === "first_seen" && o.method === "import_manual");
    const signal = cardSignal(obs, { manual, colors });
    const status = isReferenceStatus(r.status) ? r.status : "new";
    const duplicate = sameConstruction(lites, { brand: r.brand ?? null, title: r.title ?? null, referenceId: id });
    const plain = attributeMap(attributes);
    const lesson = lessonFor({ referenceId: id, direction: collection.direction, brand: r.brand ?? null, title: r.title ?? null, attributes: plain }, learning.lessons, learning.ownIds);
    const score = TONE_SCORE[signal.tone] + (STATUS_SCORE[status] ?? 0) - (duplicate ? 5 : 0) - (lesson?.penalty ?? 0);
    return {
      id,
      title: String(r.title ?? ""),
      brand: r.brand ? String(r.brand) : null,
      status,
      coverUrl: photos.get(id)?.[0] ?? null,
      signal,
      duplicateOf: duplicate?.title ?? null,
      lesson: lesson?.note ?? null,
      attributes: plain,
      score,
    };
  }).sort((a, b) => b.score - a.score);
}

export interface DraftView extends DraftResult {
  cards: Record<string, CandidateCard>;
}

/** Черновик плана сумок: предложение, а не решение — добавляет человек. */
export async function suggestDraft(db: SupabaseClient, collectionId: string): Promise<DraftView> {
  const collection = await readCollectionRow(db, collectionId);
  if (collection.kind !== "bags_month") throw new CollectionInputError("Черновик собирается только для плана сумок.");
  const { rows: items } = await readItems(db, [collectionId]);
  const progress = planProgress(collection.kind, items.map((i) => lite(i, undefined)));
  const candidates = await loadCandidates(db, collectionId);
  const result = assembleDraft(candidates, progress.freeSlots.length, Math.max(0, 3 - progress.reserves));
  const picked = new Set(result.picks.map((p) => p.id));
  return { ...result, cards: Object.fromEntries(candidates.filter((c) => picked.has(c.id)).map((c) => [c.id, c])) };
}
