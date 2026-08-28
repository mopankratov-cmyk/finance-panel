import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCabinetsForScope } from "@/lib/warehouse/kizScope";
import { collectKizFromTasks, KizTasksMigrationError } from "@/lib/warehouse/kizTasks";
import { fetchFbsOrderStatuses, fetchFbsOrdersMetaBatch } from "@/lib/wb/fbsMarketplace";
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
    { entityId?: string | null; probeNm?: number | null; probeNmList?: number[] | null } | null;
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
  if (body?.probeNm || body?.probeNmList?.length) {
    const nmList = body?.probeNmList?.length
      ? body.probeNmList.map(Number).filter((nm) => Number.isFinite(nm) && nm > 0)
      : [Number(body?.probeNm)];
    const { data: taskRows } = await db
      .from("wb_fbs_orders")
      .select("cabinet_id, order_id, article, created_at_wb, srid, nm_id")
      .in("cabinet_id", cabinetIds)
      .in("nm_id", nmList)
      .order("created_at_wb", { ascending: false })
      .limit(600);
    const tasks = (taskRows ?? []).filter((row) => Number(row.order_id) > 0);
    if (!tasks.length) return fail(`Заданий по nm ${nmList.join(", ")} в базе не нашлось`, 404);
    const byCabinet = new Map<string, number[]>();
    for (const row of tasks) {
      const list = byCabinet.get(String(row.cabinet_id)) ?? [];
      list.push(Number(row.order_id));
      byCabinet.set(String(row.cabinet_id), list);
    }
    const taskInfo = new Map(tasks.map((row) => [Number(row.order_id), row]));
    const out: Array<Record<string, unknown>> = [];
    for (const [cabinetId, orderIds] of byCabinet) {
      const cabinet = await getWbCabinet(cabinetId);
      if (!cabinet) continue;
      const token = resolveWbToken(cabinet, "marketplace");
      // Статусы и коды живьём: спор о выкупленности и привязке решают только
      // фактические ответы WB по каждому заданию.
      const { statuses } = await fetchFbsOrderStatuses(token, orderIds);
      const result = await fetchFbsOrdersMetaBatch(token, orderIds);
      for (const orderId of orderIds) {
        const info = taskInfo.get(orderId);
        const status = statuses.get(orderId);
        out.push({
          orderId,
          article: info?.article ?? null,
          nmId: info?.nm_id ?? null,
          createdAt: info?.created_at_wb ? String(info.created_at_wb).slice(0, 10) : null,
          supplierStatus: status?.supplierStatus ?? null,
          wbStatus: status?.wbStatus ?? null,
          code: (result.codes.get(orderId) ?? [])[0] ?? null,
        });
      }
    }
    return NextResponse.json({ data: { nmList, tasks: tasks.length, rows: out }, error: null });
  }

  try {
    return NextResponse.json({ data: await collectKizFromTasks(db, cabinetIds), error: null });
  } catch (error) {
    if (error instanceof KizTasksMigrationError) return fail(error.message, 503);
    return fail(error instanceof Error ? error.message : String(error), 500);
  }
}
