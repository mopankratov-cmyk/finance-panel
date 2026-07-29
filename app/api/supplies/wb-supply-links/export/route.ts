import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { parseWmsOrders } from "@/lib/supplies/wms";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";
import { buildXlsx } from "@/lib/xlsx/write";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const params = new URL(request.url).searchParams;
  const runId = params.get("runId")?.trim();
  const warehouse = params.get("warehouse")?.normalize("NFKC").trim();
  if (!runId || !warehouse) return fail("Укажите dry-run и склад", 400);
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const { data: run, error: runError } = await db.from("wms_order_runs").select("id, cabinet_id, import_id, plan_json").eq("id", runId).maybeSingle();
  if (runError) return fail(runError.message, 500);
  if (!run) return fail("Dry-run не найден", 404);
  const cabinetId = String(run.cabinet_id);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  const order = parseWmsOrders(run.plan_json)?.find((item) => item.warehouse === warehouse);
  if (!order) return fail("Склад отсутствует в dry-run", 404);
  const [{ data: link, error: linkError }, { data: rawLines, error: linesError }, allowedNmIds] = await Promise.all([
    db.from("wms_wb_supply_links").select("supply_id").eq("run_id", run.id).eq("warehouse", warehouse).maybeSingle(),
    db.from("wms_tara_lines").select("container, nm_id, article, barcode, quantity").eq("import_id", run.import_id),
    requestAllowedNmIds(cabinetId),
  ]);
  if (linkError) return fail(linkError.code === "42P01" ? "Примените миграцию 20260713_wb_supply_links.sql" : linkError.message, linkError.code === "42P01" ? 503 : 500);
  if (!link) return fail("Сначала привяжите поставку WB", 409);
  if (linesError) return fail(linesError.message, 500);
  const allLines = rawLines ?? [];
  if (allowedNmIds !== null && allLines.some((line) => line.nm_id == null || !allowedNmIds.has(Number(line.nm_id)))) return fail("Товарный контур кабинета изменился. Создайте новый dry-run", 403);
  const containers = new Set(order.containers);
  const selected = allLines.filter((line) => containers.has(String(line.container)));
  if (!selected.length) return fail("Для склада не найдена раскладка по коробам", 404);

  const rows: (string | number)[][] = [
    ["Поставка WB", Number(link.supply_id)],
    ["Склад", warehouse],
    ["Важно", "Официальный API WB не принимает упаковку. Загрузите этот файл вручную в кабинете WB, затем нажмите «Перепроверить»."],
    [],
    ["Номер короба", "Штрихкод товара", "Количество", "Артикул продавца", "nmID"],
    ...selected.map((line) => [String(line.container), String(line.barcode ?? ""), Number(line.quantity), String(line.article ?? ""), line.nm_id == null ? "" : Number(line.nm_id)]),
  ];
  const xlsx = buildXlsx("Раскладка по коробам", rows);
  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="wb_supply_${Number(link.supply_id)}_packages.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
