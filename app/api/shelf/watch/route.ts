import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Реестр отслеживаемых артикулов раздела «Полки». Внешний селлер пользуется
// разделом полностью — ведёт конкурентов СВОЕГО кабинета: tenant-границу
// держит hasCabinetAccess (чужой кабинет и агрегат all для него — 403).
// Смена списка меняет только будущие сборы; история снимков остаётся.
const READ_ROLES = ["director", "finance", "manager", "seller"] as const;
const WRITE_ROLES = ["director", "finance", "manager", "seller"] as const;

const BRAND_LIST_LIMIT = 50;

function parseBrandList(value: unknown): string[] | { error: string } {
  if (value == null) return [];
  if (!Array.isArray(value)) return { error: "Список брендов должен быть массивом строк" };
  const brands = value.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (brands.length > BRAND_LIST_LIMIT) return { error: `Не больше ${BRAND_LIST_LIMIT} брендов` };
  return [...new Set(brands)];
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession([...READ_ROLES]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });

  const cabinetParam = new URL(request.url).searchParams.get("cabinet");
  const cabinetId = cabinetParam && cabinetParam !== "all" ? cabinetParam : null;
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  // Только НАШИ товары. Артикулы конкурентов лежат в той же таблице с
  // purpose='price' — они нужны сборщику ради цены и на экране «Полок»
  // им делать нечего: без фильтра 96 чужих карточек засоряли список.
  let watchQ = db
    .from("wb_shelf_watch")
    .select("id, cabinet_id, nm_id, supplier_article, our_brand, our_link, our_img, extra_excluded_brands, active, created_at")
    .order("created_at", { ascending: true });
  watchQ = watchQ.eq("purpose", "shelf");
  if (cabinetId) watchQ = watchQ.eq("cabinet_id", cabinetId);
  const watches = await watchQ;
  if (watches.error) return NextResponse.json({ error: watches.error.message }, { status: 502 });

  let settings: { cabinet_id: string; global_excluded_brands: string[] }[] = [];
  {
    let settingsQ = db.from("wb_shelf_cabinet_settings").select("cabinet_id, global_excluded_brands");
    if (cabinetId) settingsQ = settingsQ.eq("cabinet_id", cabinetId);
    const loaded = await settingsQ;
    if (loaded.error) return NextResponse.json({ error: loaded.error.message }, { status: 502 });
    settings = (loaded.data ?? []) as typeof settings;
  }

  return NextResponse.json({ watches: watches.data ?? [], settings });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession([...WRITE_ROLES]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    cabinetId?: string;
    nmId?: unknown;
    supplierArticle?: unknown;
  };
  const cabinetId = String(body.cabinetId ?? "").trim();
  const nmId = Number(body.nmId);
  if (!cabinetId) return NextResponse.json({ error: "Укажите кабинет" }, { status: 400 });
  if (!Number.isInteger(nmId) || nmId <= 0) {
    return NextResponse.json({ error: "Артикул WB — положительное целое число" }, { status: 400 });
  }
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  const cabinet = await db.from("wb_cabinets").select("id").eq("id", cabinetId).maybeSingle();
  if (cabinet.error) return NextResponse.json({ error: cabinet.error.message }, { status: 502 });
  if (!cabinet.data) return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 });

  const supplierArticle = body.supplierArticle == null ? null : String(body.supplierArticle).trim() || null;
  const inserted = await db
    .from("wb_shelf_watch")
    .insert({ cabinet_id: cabinetId, nm_id: nmId, supplier_article: supplierArticle })
    .select("id")
    .maybeSingle();
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      return NextResponse.json({ error: "Этот артикул уже отслеживается в кабинете" }, { status: 409 });
    }
    return NextResponse.json({ error: inserted.error.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, id: inserted.data?.id ?? null });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireApiSession([...WRITE_ROLES]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    active?: unknown;
    supplierArticle?: unknown;
    extraExcludedBrands?: unknown;
  };
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Укажите запись реестра" }, { status: 400 });

  const existing = await db.from("wb_shelf_watch").select("id, cabinet_id").eq("id", id).maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 502 });
  if (!existing.data) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  if (!(await hasCabinetAccess(String(existing.data.cabinet_id)))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return NextResponse.json({ error: "active — только true/false" }, { status: 400 });
    patch.active = body.active;
  }
  if (body.supplierArticle !== undefined) {
    patch.supplier_article = body.supplierArticle == null ? null : String(body.supplierArticle).trim() || null;
  }
  if (body.extraExcludedBrands !== undefined) {
    const brands = parseBrandList(body.extraExcludedBrands);
    if (!Array.isArray(brands)) return NextResponse.json({ error: brands.error }, { status: 400 });
    patch.extra_excluded_brands = brands;
  }

  const updated = await db.from("wb_shelf_watch").update(patch).eq("id", id);
  if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 502 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireApiSession([...WRITE_ROLES]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { id?: string; confirm?: string };
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Укажите запись реестра" }, { status: 400 });
  // Удаление сносит и всю историю снимков (cascade) — требуем явного подтверждения.
  if (body.confirm !== "DELETE_WATCH_WITH_HISTORY") {
    return NextResponse.json({ error: "Удаление вместе с историей требует подтверждения" }, { status: 400 });
  }

  const existing = await db.from("wb_shelf_watch").select("id, cabinet_id").eq("id", id).maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 502 });
  if (!existing.data) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  if (!(await hasCabinetAccess(String(existing.data.cabinet_id)))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  const removed = await db.from("wb_shelf_watch").delete().eq("id", id);
  if (removed.error) return NextResponse.json({ error: removed.error.message }, { status: 502 });
  return NextResponse.json({ ok: true });
}

// Глобальные бренды-исключения кабинета (поверх авто-исключения своего бренда).
export async function PUT(request: NextRequest) {
  const gate = await requireApiSession([...WRITE_ROLES]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { cabinetId?: string; globalExcludedBrands?: unknown };
  const cabinetId = String(body.cabinetId ?? "").trim();
  if (!cabinetId) return NextResponse.json({ error: "Укажите кабинет" }, { status: 400 });
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  // Для внутренних ролей hasCabinetAccess не проверяет существование кабинета —
  // без явной проверки upsert упал бы сырой ошибкой FK Postgres.
  const cabinet = await db.from("wb_cabinets").select("id").eq("id", cabinetId).maybeSingle();
  if (cabinet.error) return NextResponse.json({ error: "Сервис кабинетов временно недоступен" }, { status: 502 });
  if (!cabinet.data) return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 });
  const brands = parseBrandList(body.globalExcludedBrands);
  if (!Array.isArray(brands)) return NextResponse.json({ error: brands.error }, { status: 400 });

  const saved = await db
    .from("wb_shelf_cabinet_settings")
    .upsert({ cabinet_id: cabinetId, global_excluded_brands: brands, updated_at: new Date().toISOString() });
  if (saved.error) return NextResponse.json({ error: "Не удалось сохранить исключения" }, { status: 502 });
  return NextResponse.json({ ok: true, globalExcludedBrands: brands });
}
