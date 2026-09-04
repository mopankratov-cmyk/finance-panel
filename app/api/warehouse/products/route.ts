import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";
import { isExternalSeller } from "@/lib/warehouse/operatorScope";
import { canManageStock, OPERATOR_FORBIDDEN } from "@/lib/warehouse/operatorScope";
import {
  PRODUCT_COLUMNS, PRODUCT_COLUMNS_LEGACY, isMissingColumn, toProductRow, type DbProduct, type ProductRow,
} from "@/lib/warehouse/productRow";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608230006_products.sql и 202608230007_stock_functions_products.sql";

/** loadAllSupabasePages отдаёт только текст ошибки, кода в нём нет: «колонки нет»
 *  (42703 / PGRST204) узнаём по формулировке Postgres и PostgREST. */
const isMissingColumnMessage = (error: unknown) =>
  error instanceof Error && /column [^ ]+ does not exist|could not find the '[^']+' column/i.test(error.message);

/** Ключи тела, которые появились с миграцией 202609040002. На старой базе
 *  запись с ними падает 42703 — тогда пишем без них. */
const NEW_COLUMNS = ["model", "color", "imt_id", "is_novelty"] as const;

const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value: unknown): string | null => String(value ?? "").trim() || null;

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entity");
  const query = (url.searchParams.get("q") ?? "").trim();
  // Юрлицо приходит из адреса, и раньше его не сверял никто: подставив чужой
  // идентификатор, можно было получить каталог другой компании вместе с
  // закупочной ценой. Проверяем так же, как это делает POST ниже.
  if (entityId && !list.rows.some((row) => row.id === entityId)) return fail("Нет доступа к юрлицу", 403);

  const names = new Map(list.rows.map((row) => [row.id, row.name]));

  // Внешней компании справочник отдаётся только по её юрлицам. Без этого запрос
  // без параметра `entity` вернул бы ей все товары группы вместе с закупочной
  // ценой — то, ради чего границу и проводили.
  const session = await getServerSession();
  const ownEntities = isExternalSeller(session?.role) ? list.rows.map((row) => row.id) : null;
  if (ownEntities !== null && ownEntities.length === 0) {
    return NextResponse.json({ data: [], error: null });
  }

  // Список колонок здесь переменная, а не литерал, и разбор типов запроса в
  // supabase-js на нём сдаётся — форму строки задаём сами.
  const loadProducts = (columns: string) => loadAllSupabasePages<DbProduct>((from, to) => {
    let request = db.from("products_view").select(columns).order("article").range(from, to);
    if (entityId) request = request.eq("legal_entity_id", entityId);
    else if (ownEntities !== null) request = request.in("legal_entity_id", ownEntities);
    if (query) request = request.or(`article.ilike.%${query}%,name.ilike.%${query}%,barcode.ilike.%${query}%`);
    return request as unknown as PromiseLike<{ data: DbProduct[] | null; error: { message: string } | null }>;
  });

  let rows: DbProduct[];
  try {
    try {
      rows = await loadProducts(PRODUCT_COLUMNS);
    } catch (error) {
      // База без модели и цвета — вкладка «Товары» от этого ложиться не должна.
      if (!isMissingColumnMessage(error)) throw error;
      rows = await loadProducts(PRODUCT_COLUMNS_LEGACY);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить товары";
    return fail(message.includes("does not exist") ? `${message} · ${migrationHint}` : message, 500);
  }

  return NextResponse.json({ data: rows.map((row) => toProductRow(row, names)), error: null });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const session = await getServerSession();
  // Справочник — зона администратора и менеджера: оператор фулфилмента
  // принимает и отгружает то, что в нём есть, но не заводит новое.
  if (!canManageStock(session?.role)) return fail(OPERATOR_FORBIDDEN, 403);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const article = String(body.article ?? "").trim();
  if (!article) return fail("Укажите артикул", 400);

  const list = await listAccessibleEntities();
  if (!list.ok) return fail(list.error, list.status);
  let entityId = body.legalEntityId ? String(body.legalEntityId) : null;
  if (entityId && !list.rows.some((row) => row.id === entityId)) return fail("Нет доступа к юрлицу", 403);
  // Товар без юрлица считается общим и виден всем. Внешней компании такой
  // заводить нельзя: её карточка сразу оказалась бы в чужих справочниках.
  if (isExternalSeller(session?.role)) {
    entityId = entityId ?? list.rows[0]?.id ?? null;
    if (!entityId) return fail("Нет доступного юрлица", 403);
  }

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const row: Record<string, unknown> = {
    legal_entity_id: entityId,
    article,
    name: String(body.name ?? "").trim() || article,
    barcode: text(body.barcode),
    category: text(body.category),
    brand: text(body.brand),
    nm_id: number(body.nmId),
    photo_url: text(body.photoUrl),
    factory_price: number(body.factoryPrice),
    factory_currency: ["CNY", "RUB", "USD"].includes(String(body.factoryCurrency)) ? String(body.factoryCurrency) : "RUB",
    weight_kg: number(body.weightKg),
    length_cm: number(body.lengthCm),
    width_cm: number(body.widthCm),
    height_cm: number(body.heightCm),
    min_stock: number(body.minStock),
    season: body.season === "summer" || body.season === "winter" ? body.season : null,
    note: text(body.note),
    created_by: session?.email ?? null,
  };
  // Новые поля кладём только когда их прислали: старый клиент на старой базе
  // не должен платить повторной вставкой за колонки, о которых не просил.
  if ("model" in body) row.model = text(body.model);
  if ("color" in body) row.color = text(body.color);
  if ("imtId" in body) row.imt_id = number(body.imtId);
  if ("isNovelty" in body) row.is_novelty = Boolean(body.isNovelty);

  let inserted = await db.from("products").insert(row).select("id").single();
  if (inserted.error && isMissingColumn(inserted.error.code) && NEW_COLUMNS.some((key) => key in row)) {
    for (const key of NEW_COLUMNS) delete row[key];
    inserted = await db.from("products").insert(row).select("id").single();
  }

  const { data, error } = inserted;
  if (error) {
    if (error.code === "23505") return fail("Товар с таким артикулом уже есть", 409);
    return fail(missingMigration(error.code) ? migrationHint : error.message, missingMigration(error.code) ? 503 : 500);
  }

  let created = await db.from("products_view").select(PRODUCT_COLUMNS).eq("id", data.id).single();
  if (created.error && isMissingColumn(created.error.code)) {
    created = await db.from("products_view").select(PRODUCT_COLUMNS_LEGACY).eq("id", data.id).single();
  }
  const names = new Map(list.rows.map((row) => [row.id, row.name]));
  return NextResponse.json({ data: toProductRow(created.data as DbProduct, names) satisfies ProductRow, error: null }, { status: 201 });
}
