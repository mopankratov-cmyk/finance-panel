import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return fail("Некорректный id теста", 400);
  const body = await request.json().catch(() => null) as { confirm?: string } | null;
  if (body?.confirm !== "DELETE_DRAFT") return fail("Нужно явное подтверждение удаления черновика", 400);
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const { data: test, error } = await db.from("ctr_tests").select("cabinet_id, status").eq("id", id).maybeSingle();
  if (error) return fail(error.message, 500);
  if (!test?.cabinet_id) return fail("Тест не найден", 404);
  if (!(await hasCabinetAccess(String(test.cabinet_id)))) return fail("Нет доступа к кабинету", 403);
  if (test.status !== "draft") return fail("Удалить можно только черновик; работающий тест сначала отмените", 409);
  const result = await db.from("ctr_tests").delete().eq("id", id).eq("status", "draft");
  if (result.error) return fail(result.error.message, 500);
  return NextResponse.json({ data: { ok: true }, error: null });
}
