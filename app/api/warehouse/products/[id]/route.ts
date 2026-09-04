import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import { canManageStock, OPERATOR_FORBIDDEN } from "@/lib/warehouse/operatorScope";
import { PRODUCT_COLUMNS, PRODUCT_COLUMNS_LEGACY, isMissingColumn, toProductRow, type DbProduct } from "@/lib/warehouse/productRow";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

/** Колонки миграции 202609040002. На старой базе запись с ними падает 42703 —
 *  тогда убираем их из правки и пишем остальное. */
const NEW_COLUMNS = ["model", "color", "imt_id", "is_novelty"] as const;

const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const session = await getServerSession();
  // Справочник — зона администратора и менеджера: оператор фулфилмента
  // работает с тем, что в нём есть, но не правит.
  if (!canManageStock(session?.role)) return fail(OPERATOR_FORBIDDEN, 403);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  // Меняем только то, что прислали: пустое поле формы — это «очистить», а отсутствующее —
  // «не трогать», и путать их нельзя.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("article" in body) {
    const article = String(body.article ?? "").trim();
    if (!article) return fail("Артикул не может быть пустым", 400);
    patch.article = article;
  }
  if ("legalEntityId" in body) {
    const entityId = body.legalEntityId ? String(body.legalEntityId) : null;
    if (entityId && !list.rows.some((row) => row.id === entityId)) return fail("Нет доступа к юрлицу", 403);
    patch.legal_entity_id = entityId;
  }
  if ("name" in body) patch.name = String(body.name ?? "").trim();
  if ("barcode" in body) patch.barcode = String(body.barcode ?? "").trim() || null;
  if ("category" in body) patch.category = String(body.category ?? "").trim() || null;
  if ("brand" in body) patch.brand = String(body.brand ?? "").trim() || null;
  if ("nmId" in body) patch.nm_id = number(body.nmId);
  if ("photoUrl" in body) patch.photo_url = String(body.photoUrl ?? "").trim() || null;
  if ("factoryPrice" in body) patch.factory_price = number(body.factoryPrice);
  if ("factoryCurrency" in body && ["CNY", "RUB", "USD"].includes(String(body.factoryCurrency))) {
    patch.factory_currency = String(body.factoryCurrency);
  }
  if ("weightKg" in body) patch.weight_kg = number(body.weightKg);
  if ("lengthCm" in body) patch.length_cm = number(body.lengthCm);
  if ("widthCm" in body) patch.width_cm = number(body.widthCm);
  if ("heightCm" in body) patch.height_cm = number(body.heightCm);
  if ("minStock" in body) patch.min_stock = number(body.minStock);
  if ("season" in body) patch.season = body.season === "summer" || body.season === "winter" ? body.season : null;
  if ("isActive" in body) patch.is_active = Boolean(body.isActive);
  if ("note" in body) patch.note = String(body.note ?? "").trim() || null;
  // Модель, цвет и карточка WB правятся руками — импорт из карточки их не перетирает.
  if ("model" in body) patch.model = String(body.model ?? "").trim() || null;
  if ("color" in body) patch.color = String(body.color ?? "").trim() || null;
  if ("imtId" in body) patch.imt_id = number(body.imtId);
  if ("isNovelty" in body) patch.is_novelty = Boolean(body.isNovelty);

  let updated = await db.from("products").update(patch).eq("id", id);
  if (updated.error && isMissingColumn(updated.error.code) && NEW_COLUMNS.some((key) => key in patch)) {
    for (const key of NEW_COLUMNS) delete patch[key];
    updated = await db.from("products").update(patch).eq("id", id);
  }
  if (updated.error) {
    if (updated.error.code === "23505") return fail("Товар с таким артикулом уже есть", 409);
    return fail(updated.error.message, 500);
  }

  let fresh = await db.from("products_view").select(PRODUCT_COLUMNS).eq("id", id).maybeSingle();
  if (fresh.error && isMissingColumn(fresh.error.code)) {
    fresh = await db.from("products_view").select(PRODUCT_COLUMNS_LEGACY).eq("id", id).maybeSingle();
  }
  if (fresh.error || !fresh.data) return fail(fresh.error?.message ?? "Товар не найден", 404);
  const names = new Map(list.rows.map((row) => [row.id, row.name]));
  return NextResponse.json({ data: toProductRow(fresh.data as DbProduct, names), error: null });
}
