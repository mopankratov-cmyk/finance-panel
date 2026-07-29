import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";

export const dynamic = "force-dynamic";

// План по SKU в режиме планирования РНП. GET → {plan:{<nm>:{<field>:value}}}; POST сохраняет одну ячейку.
export async function GET(request: NextRequest, ctx: { params: Promise<{ shop: string }> }) {
  const { shop } = await ctx.params;
  const { cabinetId } = await resolveShopCabinet(shop);
  if (shop !== "all" && !cabinetId) return NextResponse.json({ error: "WB-кабинет не найден" }, { status: 404 });
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к выбранному WB-кабинету" }, { status: 403 });
  }
  const month = new URL(request.url).searchParams.get("month") || "";
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ plan: {} });
  const { data, error } = await db
    .from("rnp_plan")
    .select("nm, field, value")
    .eq("shop", shop)
    .eq("month", month);
  if (error) return NextResponse.json({ plan: {} });
  const plan: Record<string, Record<string, number>> = {};
  for (const r of data ?? []) {
    (plan[String(r.nm)] ||= {})[r.field as string] = Number(r.value);
  }
  return NextResponse.json({ plan });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ shop: string }> }) {
  const { shop } = await ctx.params;
  const { cabinetId } = await resolveShopCabinet(shop);
  if (!cabinetId) return NextResponse.json({ error: "Для планирования выберите один WB-кабинет" }, { status: 400 });
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к выбранному WB-кабинету" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = await request.json().catch(() => ({}));
  const { month, nm, field, value } = b as { month?: string; nm?: string; field?: string; value?: number | null };
  if (!month || !nm || !field) return NextResponse.json({ error: "month/nm/field обязательны" }, { status: 400 });
  if (value != null && !Number.isFinite(Number(value))) return NextResponse.json({ error: "value должен быть числом" }, { status: 400 });

  if (value == null) {
    const { error } = await db.from("rnp_plan").delete().eq("shop", shop).eq("month", month).eq("nm", String(nm)).eq("field", field);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await db.from("rnp_plan").upsert(
      { shop, month, nm: String(nm), field, value, updated_at: new Date().toISOString() },
      { onConflict: "shop,month,nm,field" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
