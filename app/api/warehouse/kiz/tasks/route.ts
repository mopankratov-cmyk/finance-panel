import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCabinetsForScope } from "@/lib/warehouse/kizScope";
import { collectKizFromTasks, KizTasksMigrationError } from "@/lib/warehouse/kizTasks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export type { KizTasksResult } from "@/lib/warehouse/kizTasks";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

/** Кнопка «Обновить»: быстрый шаг по нашей базе, без обращений к WB. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const body = (await request.json().catch(() => null)) as { entityId?: string | null } | null;
  const scope = await wbCabinetsForScope(body?.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const cabinetIds = scope.cabinets.map((link) => link.cabinetId);
  if (cabinetIds.length === 0) {
    return fail(scope.entityName
      ? `У юрлица «${scope.entityName}» нет кабинетов Wildberries`
      : "Нет кабинетов Wildberries, связанных с юрлицами", 400);
  }

  try {
    return NextResponse.json({ data: await collectKizFromTasks(db, cabinetIds), error: null });
  } catch (error) {
    if (error instanceof KizTasksMigrationError) return fail(error.message, 503);
    return fail(error instanceof Error ? error.message : String(error), 500);
  }
}
