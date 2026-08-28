import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCabinetsForScope } from "@/lib/warehouse/kizScope";
import { collectKizFromTasks, KizTasksMigrationError } from "@/lib/warehouse/kizTasks";
import { fetchFbsOrdersMetaBatch } from "@/lib/wb/fbsMarketplace";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export type { KizTasksResult } from "@/lib/warehouse/kizTasks";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

/** Кнопка «Обновить»: быстрый шаг по нашей базе, без обращений к WB. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const body = (await request.json().catch(() => null)) as
    { entityId?: string | null; probeNm?: number | null } | null;
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

  // Зонд: сырые метаданные заданий одного артикула, прямо из WB.
  //
  // Спор «в интерфейсе коды видны — API их не отдаёт» решается только
  // фактическим ответом WB по конкретным заданиям, без нашего парсера
  // между глазами и данными.
  if (body?.probeNm) {
    const probeNm = Number(body.probeNm);
    const { data: taskRows } = await db
      .from("wb_fbs_orders")
      .select("cabinet_id, order_id, article, created_at_wb")
      .in("cabinet_id", cabinetIds)
      .eq("nm_id", probeNm)
      .order("created_at_wb", { ascending: false })
      .limit(10);
    const tasks = (taskRows ?? []).filter((row) => Number(row.order_id) > 0);
    if (!tasks.length) return fail(`Заданий по nm ${probeNm} в базе не нашлось`, 404);
    const byCabinet = new Map<string, number[]>();
    for (const row of tasks) {
      const list = byCabinet.get(String(row.cabinet_id)) ?? [];
      list.push(Number(row.order_id));
      byCabinet.set(String(row.cabinet_id), list);
    }
    const out: Array<Record<string, unknown>> = [];
    for (const [cabinetId, orderIds] of byCabinet) {
      const cabinet = await getWbCabinet(cabinetId);
      if (!cabinet) continue;
      const token = resolveWbToken(cabinet, "marketplace");
      const result = await fetchFbsOrdersMetaBatch(token, orderIds);
      for (const orderId of orderIds) {
        out.push({ orderId, codes: result.codes.get(orderId) ?? null });
      }
      out.push({ rawSample: result.sample ?? "metaDetails пуст у всех спрошенных" });
    }
    return NextResponse.json({ data: { probeNm, tasks: tasks.length, meta: out }, error: null });
  }

  try {
    return NextResponse.json({ data: await collectKizFromTasks(db, cabinetIds), error: null });
  } catch (error) {
    if (error instanceof KizTasksMigrationError) return fail(error.message, 503);
    return fail(error instanceof Error ? error.message : String(error), 500);
  }
}
