import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import { resolveProductOwners, type OwnerCard, type OwnerSource } from "@/lib/warehouse/productOwners";
import { readCabinetCards } from "@/lib/wb/cabinetCards";

export const dynamic = "force-dynamic";
// Обход карточек всех своих кабинетов с обязательной паузой между страницами
// в пользовательский лимит не влезает.
export const maxDuration = 300;

export interface ProductOwnersResult {
  /** Товарам проставлено юрлицо. */
  assigned: number;
  /** Из них по номеру карточки / по артикулу / по метке из финансов. */
  byNm: number;
  byArticle: number;
  byLabel: number;
  /** Юрлицо уже стояло и подтвердилось. */
  confirmed: number;
  /** Карточка говорит одно, а в товаре стоит другое — не трогали. */
  conflicts: { article: string; current: string; found: string; evidence: string }[];
  /** Ни карточки, ни метки — владелец неизвестен. */
  unresolved: string[];
  cabinets: { name: string; cards: number; complete: boolean; failed: boolean }[];
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

/** Проставить товарам юрлицо по карточкам WB. Кнопка на вкладке «Товары». */
export async function POST() {
  const gate = await requireApiSession();
  if (gate) return gate;
  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const sources: OwnerSource[] = [];
  const cabinetStats: ProductOwnersResult["cabinets"] = [];
  for (const entity of list.rows) {
    for (const link of entity.cabinets) {
      // Агентский кабинет о собственности не говорит: там чужие карточки.
      if (link.relation !== "own") continue;
      try {
        const { cards, complete } = await readCabinetCards(link.cabinetId);
        sources.push({ entityId: entity.id, cabinetName: link.cabinetName, cards });
        cabinetStats.push({ name: link.cabinetName, cards: cards.length, complete, failed: false });
      } catch {
        cabinetStats.push({ name: link.cabinetName, cards: 0, complete: false, failed: true });
      }
    }
  }

  const productsResult = await db.from("products").select("id, article, nm_id, legal_entity_id");
  if (productsResult.error) return fail(productsResult.error.message, 500);

  // Метка владельца из финансов — последняя опора для товара без карточки WB.
  // Она бывает и названием юрлица, и названием кабинета, поэтому словарь знает оба.
  const labelToEntity = new Map<string, string>();
  for (const entity of list.rows) {
    labelToEntity.set(entity.name.trim().toLowerCase(), entity.id);
    for (const link of entity.cabinets) {
      if (link.relation === "own") labelToEntity.set(link.cabinetName.trim().toLowerCase(), entity.id);
    }
  }

  let costs: { article: string; entity: string | null }[] = [];
  try {
    costs = await loadAllSupabasePages<{ article: string; entity: string | null }>((from, to) =>
      db.from("product_costs").select("article, entity").order("article").range(from, to),
    );
  } catch {
    // Без меток просто теряем третий ярус доверия — карточки важнее.
    costs = [];
  }
  const labelByArticle = new Map<string, string>();
  for (const row of costs) {
    const article = String(row.article ?? "").trim().toLowerCase();
    if (article && row.entity) labelByArticle.set(article, row.entity);
  }

  const resolution = resolveProductOwners(
    (productsResult.data ?? []).map((row) => ({
      id: String(row.id),
      article: String(row.article ?? ""),
      nmId: row.nm_id === null || row.nm_id === undefined ? null : Number(row.nm_id),
      legalEntityId: row.legal_entity_id === null || row.legal_entity_id === undefined ? null : String(row.legal_entity_id),
      label: labelByArticle.get(String(row.article ?? "").trim().toLowerCase()) ?? null,
    })),
    sources,
    labelToEntity,
  );

  const stamped = new Date().toISOString();
  let assigned = 0;
  for (const item of resolution.assignments) {
    const { error } = await db
      .from("products")
      .update({ legal_entity_id: item.entityId, updated_at: stamped })
      .eq("id", item.productId);
    if (!error) assigned += 1;
  }

  const names = new Map(list.rows.map((row) => [row.id, row.name]));
  const result: ProductOwnersResult = {
    assigned,
    byNm: resolution.assignments.filter((item) => item.via === "nm").length,
    byArticle: resolution.assignments.filter((item) => item.via === "article").length,
    byLabel: resolution.assignments.filter((item) => item.via === "label").length,
    confirmed: resolution.confirmed,
    conflicts: resolution.conflicts.map((item) => ({
      article: item.article,
      current: names.get(item.currentEntityId) ?? "неизвестное юрлицо",
      found: names.get(item.foundEntityId) ?? "неизвестное юрлицо",
      evidence: item.evidence,
    })),
    unresolved: resolution.unresolved.map((item) => item.article),
    cabinets: cabinetStats,
  };
  return NextResponse.json({ data: result, error: null });
}
