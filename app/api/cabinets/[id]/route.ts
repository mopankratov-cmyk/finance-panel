import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit, redactSecrets } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

// PATCH — переименовать / вкл-выкл кабинет: {name?, is_active?}.
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(["director"]);
  if (gate) return gate;
  const { id } = await ctx.params;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = (await request.json().catch(() => ({}))) as { name?: string; is_active?: boolean };
  const patch: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
  if (typeof b.is_active === "boolean") patch.is_active = b.is_active;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Нечего обновлять" }, { status: 400 });
  // Update-by-id молча даёт error:null, даже если строка не найдена (опечатка
  // в id, устаревшая ссылка в UI, гонка с чужим удалением) — читаем строку ДО
  // изменения, чтобы отличить это от настоящего обновления и знать, что было.
  const { data: existing, error: existingError } = await db.from("wb_cabinets").select("*").eq("id", id).maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 });
  const { error } = await db.from("wb_cabinets").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const session = await getServerSession();
  await audit(request, session, {
    action: "cabinet.update",
    subject: String(existing.name ?? id),
    cabinetId: id,
    organizationId: existing.organization_id ? String(existing.organization_id) : null,
    before: redactSecrets(existing as Record<string, unknown>),
    after: patch,
  });
  return NextResponse.json({ ok: true });
}

// DELETE — удалить кабинет.
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(["director"]);
  if (gate) return gate;
  const { id } = await ctx.params;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  // Удаление кабинета необратимо и роняет всю его аналитику разом — читаем
  // строку ДО удаления: без этого проверка «есть ли кабинет» не отличит
  // удаление несуществующего id от настоящего, а журнал не узнает, что
  // именно пропало.
  const { data: existing, error: existingError } = await db.from("wb_cabinets").select("*").eq("id", id).maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 });
  const { error } = await db.from("wb_cabinets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const session = await getServerSession();
  await audit(request, session, {
    action: "cabinet.delete",
    subject: String(existing.name ?? id),
    cabinetId: id,
    organizationId: existing.organization_id ? String(existing.organization_id) : null,
    before: redactSecrets(existing as Record<string, unknown>),
    after: { deleted: true },
  });
  return NextResponse.json({ ok: true });
}
