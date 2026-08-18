import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { SKU_ORDER_LIMIT } from "@/lib/wb/skuOrder";

export const dynamic = "force-dynamic";

// Ручной порядок выдачи артикулов кабинета: настраивается в РНП, читается
// всеми экранами со списками SKU. Порядок — представление, не деньги, поэтому
// править может и менеджер.
const READ_ROLES = ["director", "finance", "manager", "seller"] as const;
// Порядок выдачи — представление своего кабинета, а не владельческая настройка:
// селлер ведёт его сам (tenant-границу держит hasCabinetAccess).
const WRITE_ROLES = ["director", "finance", "manager", "seller"] as const;

export async function GET(request: NextRequest) {
  const gate = await requireApiSession([...READ_ROLES]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });

  const cabinetParam = new URL(request.url).searchParams.get("cabinet");
  const cabinetId = cabinetParam && cabinetParam !== "all" ? cabinetParam : null;
  if (!cabinetId) return NextResponse.json({ nmIds: [] });
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  const row = await db.from("wb_sku_order").select("nm_ids, updated_at, updated_by").eq("cabinet_id", cabinetId).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 502 });
  return NextResponse.json({
    nmIds: (row.data?.nm_ids ?? []).map(Number).filter((nm: number) => Number.isFinite(nm)),
    updatedAt: row.data?.updated_at ?? null,
    updatedBy: row.data?.updated_by ?? null,
  });
}

export async function PUT(request: NextRequest) {
  const gate = await requireApiSession([...WRITE_ROLES]);
  if (gate) return gate;
  const session = await getServerSession();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { cabinetId?: string; nmIds?: unknown };
  const cabinetId = String(body.cabinetId ?? "").trim();
  if (!cabinetId) return NextResponse.json({ error: "Укажите кабинет" }, { status: 400 });
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  if (!Array.isArray(body.nmIds)) return NextResponse.json({ error: "nmIds: нужен массив артикулов" }, { status: 400 });
  if (body.nmIds.length > SKU_ORDER_LIMIT) {
    return NextResponse.json({ error: `Не больше ${SKU_ORDER_LIMIT} артикулов` }, { status: 400 });
  }
  const seen = new Set<number>();
  const nmIds: number[] = [];
  for (const raw of body.nmIds) {
    const nm = Number(raw);
    if (!Number.isInteger(nm) || nm <= 0) {
      return NextResponse.json({ error: "nmIds: каждый артикул — положительное целое" }, { status: 400 });
    }
    if (seen.has(nm)) continue;
    seen.add(nm);
    nmIds.push(nm);
  }

  const cabinet = await db.from("wb_cabinets").select("id").eq("id", cabinetId).maybeSingle();
  if (cabinet.error) return NextResponse.json({ error: "Сервис кабинетов временно недоступен" }, { status: 502 });
  if (!cabinet.data) return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 });

  const saved = await db.from("wb_sku_order").upsert({
    cabinet_id: cabinetId,
    nm_ids: nmIds,
    updated_by: session?.email ?? session?.role ?? null,
    updated_at: new Date().toISOString(),
  });
  if (saved.error) return NextResponse.json({ error: "Не удалось сохранить порядок" }, { status: 502 });
  return NextResponse.json({ ok: true, count: nmIds.length });
}
