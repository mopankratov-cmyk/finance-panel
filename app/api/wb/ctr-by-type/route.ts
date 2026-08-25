import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// CTR в разрезе типа оплаты рекламы: CPC, CPM, ЕРК.
//
// Воронка считает CTR за день по всем кампаниям артикула сразу. Если по товару
// одновременно идут CPC и CPM, среднее вводит в заблуждение: ярко запущенная
// CPC вытягивает цифру вверх, и по ней уже нельзя судить о поиске, на который
// смотрят в первую очередь.
//
// Источник — снимок журнала РК: там у каждой строки уже проставлен вид
// размещения (cpc_search, cpm_shelf, erk и т.д.), посчитанный по настройкам
// кампании из WB. Считать тип заново здесь значило бы завести вторую правду.
export const dynamic = "force-dynamic";

export type CtrPaymentType = "cpc" | "cpm" | "erk";

/** Вид размещения → тип оплаты. Приставка блока и есть ответ. */
function paymentOf(block: string): CtrPaymentType | null {
  if (block.startsWith("cpc")) return "cpc";
  if (block.startsWith("cpm")) return "cpm";
  if (block === "erk") return "erk";
  // «Вид не определён» и конверсии из других кампаний в разрез не берём:
  // приписать их к CPC или CPM значило бы выдумать.
  return null;
}

export interface CtrTypeCell { views: number; clicks: number }
/** Ключ — `nm|дата`, значение — показы и клики по каждому типу оплаты. */
export type CtrTypeMap = Record<string, Partial<Record<CtrPaymentType, CtrTypeCell>>>;

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const url = new URL(request.url);
  const cabinetId = cabinetIdFromParam(url.searchParams.get("cabinet"));
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ byType: {} });

  const from = String(url.searchParams.get("from") ?? "").trim();
  const till = String(url.searchParams.get("till") ?? "").trim();

  let query = db.from("wb_rk_journal_daily").select("nm_id, date, block, views, clicks");
  if (cabinetId) query = query.eq("cabinet_id", cabinetId);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("date", from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(till)) query = query.lte("date", till);

  const { data, error } = await query.limit(50_000);
  // Снимка ещё нет — экран живёт как раньше, без разреза по типам.
  if (error || !data) return NextResponse.json({ byType: {} });

  const byType: CtrTypeMap = {};
  for (const row of data) {
    const payment = paymentOf(String(row.block ?? ""));
    if (!payment) continue;
    const key = `${Number(row.nm_id)}|${String(row.date)}`;
    const cell = (byType[key] ??= {});
    const acc = (cell[payment] ??= { views: 0, clicks: 0 });
    acc.views += Number(row.views ?? 0);
    acc.clicks += Number(row.clicks ?? 0);
  }

  return NextResponse.json({ byType });
}
