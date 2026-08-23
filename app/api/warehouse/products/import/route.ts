import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { planProductImport, type CatalogCard, type NewProduct } from "@/lib/warehouse/missingProducts";
import { readCabinetCards } from "@/lib/wb/cabinetCards";

export const dynamic = "force-dynamic";
// Обход карточек постраничный, с паузами — в пользовательский лимит не влезает.
export const maxDuration = 300;

/** Полгода без заказа — товар мёртв, если карточка старше этого срока. */
const WINDOW_DAYS = 180;

export interface ProductImportPlanRow {
  brand: string;
  cards: { article: string; name: string; nmId: number }[];
}

export interface ProductImportResult {
  /** Что предлагается завести, сгруппировано по бренду. */
  plan: ProductImportPlanRow[];
  /** Старые карточки без заказов за полгода — по умолчанию не заводим. */
  stale: ProductImportPlanRow[];
  /** Сколько создано. Ноль при разведке (apply не передан). */
  created: number;
  applied: boolean;
  cabinets: { name: string; cards: number; complete: boolean; failed: boolean }[];
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

const group = (rows: NewProduct[]): ProductImportPlanRow[] => {
  const byBrand = new Map<string, ProductImportPlanRow>();
  for (const row of rows) {
    const brand = row.brand ?? "без бренда";
    const bucket = byBrand.get(brand) ?? { brand, cards: [] };
    bucket.cards.push({ article: row.article, name: row.name, nmId: row.nmId });
    byBrand.set(brand, bucket);
  }
  return [...byBrand.values()].sort((a, b) => b.cards.length - a.cards.length);
};

/**
 * Завести в справочник товары, которые есть в карточках кабинета, но не у нас.
 * Без `apply` только разведка: человек сначала смотрит, что появится.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as
    | { entityId?: string; brands?: string[]; includeStale?: boolean; apply?: boolean }
    | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);

  // Только собственные кабинеты: в агентском карточки чужого продавца, и
  // заводить их себе в справочник значило бы присвоить чужой товар.
  const cabinets = scope.entity.cabinets.filter((link) => link.relation === "own");
  if (cabinets.length === 0) return fail(`У юрлица «${scope.entity.name}» нет собственных кабинетов`, 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const cards: CatalogCard[] = [];
  const cabinetStats: ProductImportResult["cabinets"] = [];
  const cabinetIds: string[] = [];
  for (const link of cabinets) {
    try {
      const result = await readCabinetCards(link.cabinetId);
      cards.push(...result.cards);
      cabinetIds.push(link.cabinetId);
      cabinetStats.push({ name: link.cabinetName, cards: result.cards.length, complete: result.complete, failed: false });
    } catch {
      cabinetStats.push({ name: link.cabinetName, cards: 0, complete: false, failed: true });
    }
  }
  if (cards.length === 0) return fail("Не удалось прочитать карточки кабинетов", 502);

  const wanted = (body.brands ?? []).map((brand) => brand.trim().toLowerCase()).filter(Boolean);
  const filtered = wanted.length > 0
    ? cards.filter((card) => wanted.includes(card.brand.trim().toLowerCase()))
    : cards;

  // Справочник читаем целиком, а не по юрлицу: одинаковый артикул у двух юрлиц
  // развалил бы приёмку, которая ищет товар по артикулу.
  const existingResult = await db.from("products").select("nm_id, article");
  if (existingResult.error) return fail(existingResult.error.message, 500);

  const windowStart = new Date(Date.now() - WINDOW_DAYS * 86400000);
  const candidates = filtered.map((card) => card.nmId).filter((nmId) => nmId > 0);
  const soldNmIds = new Set<number>();
  if (candidates.length > 0 && cabinetIds.length > 0) {
    // Спрашиваем заказы только по кандидатам: полный журнал кабинета за полгода
    // читать незачем, а список кандидатов — десятки строк.
    const ordersResult = await db
      .from("wb_orders")
      .select("nm_id")
      .in("cabinet_id", cabinetIds)
      .in("nm_id", candidates)
      .gte("date", windowStart.toISOString())
      .limit(10000);
    if (!ordersResult.error) {
      for (const row of ordersResult.data ?? []) soldNmIds.add(Number(row.nm_id));
    }
  }

  const plan = planProductImport(
    filtered,
    (existingResult.data ?? []).map((row) => ({
      nmId: row.nm_id === null || row.nm_id === undefined ? null : Number(row.nm_id),
      article: String(row.article ?? ""),
    })),
    { soldNmIds, windowStart, includeStale: body.includeStale },
  );

  let created = 0;
  if (body.apply) {
    const session = await getServerSession();
    const stamp = new Date().toISOString();
    for (const row of plan.create) {
      // По одной, а не пачкой: артикул уникален, и одна коллизия не должна
      // отменять весь импорт.
      const { error } = await db.from("products").insert({
        legal_entity_id: scope.entity.id,
        article: row.article,
        name: row.name,
        brand: row.brand,
        nm_id: row.nmId,
        created_by: session?.email ?? null,
        created_at: stamp,
        updated_at: stamp,
      });
      if (!error) created += 1;
    }
  }

  const result: ProductImportResult = {
    plan: group(plan.create),
    stale: group(plan.stale),
    created,
    applied: Boolean(body.apply),
    cabinets: cabinetStats,
  };
  return NextResponse.json({ data: result, error: null });
}
