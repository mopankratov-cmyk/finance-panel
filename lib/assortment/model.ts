import type { SupabaseClient } from "@supabase/supabase-js";
import { applyAttributeEdit, AttributeInputError, attributeRows, compareModels, isEditableKey, type AttributeEdit, type AttributeRow, type Attributes, type CompareResult } from "./attributes";
import type { AssortmentDirection } from "./constants";
import { ACTIONS, availableActions, DECISION_LABEL, isReferenceStatus, reasonLabel, STATUS_LABEL, type ActionId, type DecisionKind, type ReferenceStatus } from "./decisions";
import { buildEvidence, type EvidenceGroup, type EvidenceObservation, type EvidenceRow } from "./evidence";
import { storeImages, uploadedImage, type ImageBytes } from "./importer";
import { cardSignal, type CardSignal } from "./signals";
import { loadSimilar, type SimilarResult } from "./similarStore";
import { ASSORTMENT_BUCKET, isUploadPath, signedUrls } from "./storage";

export interface ModelMedia {
  id: string;
  url: string | null;
  isManual: boolean;
  originUrl: string | null;
}

export interface ModelDecision {
  id: string;
  label: string;
  reason: string | null;
  author: string | null;
  createdAt: string;
  version: number;
}

export interface ModelDetail {
  id: string;
  direction: AssortmentDirection;
  title: string;
  brand: string | null;
  article: string | null;
  region: string;
  url: string;
  status: ReferenceStatus;
  statusLabel: string;
  version: number;
  firstSeenAt: string;
  lastSeenAt: string;
  source: { id: string; name: string } | null;
  signal: CardSignal;
  media: ModelMedia[];
  evidence: Record<EvidenceGroup, EvidenceRow[]>;
  attributes: AttributeRow[];
  actions: Array<{ id: ActionId; label: string; needsReason: boolean }>;
  decisions: ModelDecision[];
  similar: SimilarResult;
}

/** Правку уже сделал кто-то другой — карточку нужно перечитать. */
export class VersionConflictError extends Error {
  constructor() {
    super("Карточку только что изменили — обновите страницу и повторите.");
  }
}

export class ModelNotFoundError extends Error {
  constructor() {
    super("Модель не найдена");
  }
}

const REF_COLUMNS = "id,direction,title,brand,article,region,url,status,version,first_seen_at,last_seen_at,attributes,source_id";

type RefRow = {
  id: string;
  direction: AssortmentDirection;
  title: string | null;
  brand: string | null;
  article: string | null;
  region: string | null;
  url: string | null;
  status: string;
  version: number;
  first_seen_at: string;
  last_seen_at: string;
  attributes: Attributes | null;
  source_id: string | null;
};

async function readRef(db: SupabaseClient, id: string): Promise<RefRow> {
  const { data, error } = await db.from("assortment_references").select(REF_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ModelNotFoundError();
  return data as RefRow;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isModelId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export async function loadModel(db: SupabaseClient, id: string): Promise<ModelDetail> {
  const ref = await readRef(db, id);
  const [{ data: observations, error: obsError }, { data: media, error: mediaError }, { data: decisions, error: decError }, { data: source }] = await Promise.all([
    db.from("assortment_observations")
      .select("group_kind,metric,value_text,value_num,null_reason,status,method,region,source_url,observed_at")
      .eq("reference_id", id),
    db.from("assortment_media").select("id,storage_path,origin_url,is_manual,position").eq("reference_id", id).order("position", { ascending: true }),
    db.from("assortment_decisions").select("id,decision,reason,author,created_at,version").eq("reference_id", id).order("created_at", { ascending: false }).limit(50),
    ref.source_id
      ? db.from("assortment_sources").select("source_id,name").eq("source_id", ref.source_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const failed = obsError ?? mediaError ?? decError;
  if (failed) throw new Error(failed.message);
  const similar = await loadSimilar(db, id, ref.direction, ref.brand);
  const otherBrands = similar.state === "ready" ? similar.items.filter((item) => !item.sameBrand).length : null;

  const obs = (observations ?? []) as EvidenceObservation[];
  const paths = (media ?? []).map((m) => String(m.storage_path)).filter(Boolean);
  const urls = await signedUrls(db, paths);
  const attributes = (ref.attributes ?? {}) as Attributes;
  const colors = Array.isArray(attributes.colors?.value) ? attributes.colors.value.length : 0;
  const manual = !ref.source_id || obs.some((o) => o.metric === "first_seen" && o.method === "import_manual");
  const status: ReferenceStatus = isReferenceStatus(ref.status) ? ref.status : "new";

  return {
    id: ref.id,
    direction: ref.direction,
    title: ref.title ?? "",
    brand: ref.brand,
    article: ref.article,
    region: ref.region ?? "",
    url: ref.url ?? "",
    status,
    statusLabel: STATUS_LABEL[status],
    version: ref.version,
    firstSeenAt: ref.first_seen_at,
    lastSeenAt: ref.last_seen_at,
    source: source ? { id: String(source.source_id), name: String(source.name) } : null,
    signal: cardSignal(obs, { manual, colors }),
    media: (media ?? []).map((m) => ({
      id: String(m.id),
      url: urls.get(String(m.storage_path)) ?? null,
      isManual: Boolean(m.is_manual),
      originUrl: m.origin_url ? String(m.origin_url) : null,
    })),
    evidence: buildEvidence(obs, otherBrands),
    attributes: attributeRows(ref.direction, attributes),
    actions: availableActions(status).map((action) => ({ id: action, label: ACTIONS[action].label, needsReason: Boolean(ACTIONS[action].needsReason) })),
    decisions: (decisions ?? []).map((d) => ({
      id: String(d.id),
      label: DECISION_LABEL[d.decision as DecisionKind] ?? String(d.decision),
      reason: reasonLabel(d.reason ? String(d.reason) : null),
      author: d.author ? String(d.author) : null,
      createdAt: String(d.created_at),
      version: Number(d.version),
    })),
    similar,
  };
}

/**
 * Решение по модели. Сначала пишем запись решения, потом меняем статус с
 * проверкой версии; если версию уже сменили — решение убираем, чтобы в
 * истории не осталось шага, которого не было.
 */
export async function applyDecision(
  db: SupabaseClient,
  id: string,
  input: { action: ActionId; expectedVersion: number; reason: string | null; author: string },
): Promise<{ version: number; status: ReferenceStatus }> {
  const ref = await readRef(db, id);
  if (ref.version !== input.expectedVersion) throw new VersionConflictError();
  const status = isReferenceStatus(ref.status) ? ref.status : "new";
  if (!availableActions(status).includes(input.action)) throw new VersionConflictError();
  const spec = ACTIONS[input.action];
  const version = input.expectedVersion + 1;

  const { data: decision, error: decisionError } = await db.from("assortment_decisions").insert({
    reference_id: id,
    decision: spec.decision,
    reason: input.reason,
    version,
    author: input.author,
  }).select("id").single();
  if (decisionError || !decision) throw new Error(decisionError?.message ?? "Решение не сохранилось");

  const { data: updated, error } = await db.from("assortment_references")
    .update({ status: spec.status, version, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("version", input.expectedVersion)
    .select("id");
  if (error || !updated || updated.length === 0) {
    await db.from("assortment_decisions").delete().eq("id", decision.id);
    if (error) throw new Error(error.message);
    throw new VersionConflictError();
  }
  return { version, status: spec.status };
}

export async function applyAttribute(
  db: SupabaseClient,
  id: string,
  input: { key: string; edit: AttributeEdit; expectedVersion: number; reviewer: string },
): Promise<{ version: number; before: unknown; after: unknown }> {
  const ref = await readRef(db, id);
  if (!isEditableKey(ref.direction, input.key)) throw new AttributeInputError("Такого признака нет");
  if (ref.version !== input.expectedVersion) throw new VersionConflictError();
  const now = new Date().toISOString();
  const attributes = (ref.attributes ?? {}) as Attributes;
  const next = applyAttributeEdit(attributes, input.key, input.edit, input.reviewer, now);
  const version = input.expectedVersion + 1;
  const { data: updated, error } = await db.from("assortment_references")
    .update({ attributes: next, version, updated_at: now })
    .eq("id", id)
    .eq("version", input.expectedVersion)
    .select("id");
  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) throw new VersionConflictError();
  return { version, before: attributes[input.key] ?? null, after: next[input.key] ?? null };
}

/** Дозагрузка фото к уже найденной модели (сайт закрыт, нужен другой ракурс). */
export async function addModelPhotos(db: SupabaseClient, id: string, uploads: unknown[]): Promise<{ stored: number; skipped: number }> {
  await readRef(db, id);
  const paths = uploads.filter(isUploadPath).slice(0, 6);
  const images: ImageBytes[] = [];
  for (const path of paths) {
    const image = await uploadedImage(db, path);
    if (image) images.push(image);
  }
  const stored = await storeImages(db, id, images, true);
  if (paths.length > 0) await db.storage.from(ASSORTMENT_BUCKET).remove(paths);
  await db.from("assortment_references").update({ last_seen_at: new Date().toISOString() }).eq("id", id);
  return { stored, skipped: paths.length - stored };
}

export interface CompareCard {
  id: string;
  title: string;
  brand: string | null;
  article: string | null;
  url: string;
  coverUrl: string | null;
}

export async function loadCompare(db: SupabaseClient, direction: AssortmentDirection, ids: string[]): Promise<{ models: CompareCard[] } & CompareResult> {
  const { data, error } = await db.from("assortment_references")
    .select("id,title,brand,article,url,attributes")
    .eq("direction", direction)
    .in("id", ids);
  if (error) throw new Error(error.message);
  const byId = new Map((data ?? []).map((row) => [String(row.id), row]));
  const rows = ids.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));

  const { data: media } = await db.from("assortment_media")
    .select("reference_id,storage_path,position")
    .in("reference_id", rows.map((r) => String(r.id)))
    .order("position", { ascending: true });
  const cover = new Map<string, string>();
  for (const m of media ?? []) if (!cover.has(String(m.reference_id))) cover.set(String(m.reference_id), String(m.storage_path));
  const urls = await signedUrls(db, [...cover.values()]);

  const models = rows.map((row): CompareCard => {
    const path = cover.get(String(row.id));
    return {
      id: String(row.id),
      title: String(row.title ?? ""),
      brand: row.brand ? String(row.brand) : null,
      article: row.article ? String(row.article) : null,
      url: String(row.url ?? ""),
      coverUrl: path ? urls.get(path) ?? null : null,
    };
  });
  // В выводах «только у …» называем бренд, если бренды разные, иначе — модель.
  const brands = rows.map((row) => String(row.brand ?? "").trim().toLowerCase());
  const brandsUnique = brands.every((brand) => brand) && new Set(brands).size === brands.length;
  const result = compareModels(direction, rows.map((row) => ({
    id: String(row.id),
    name: String((brandsUnique ? row.brand : row.title) || row.title || "модель"),
    attributes: (row.attributes ?? {}) as Attributes,
  })));
  return { models, ...result };
}
