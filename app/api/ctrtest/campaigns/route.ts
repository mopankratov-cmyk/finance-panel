import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { listCtrCampaignCandidates } from "@/lib/ctrtest/campaignBinding";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

/**
 * Список кампаний-кандидатов на артикуле — для ручного выбора в мастере
 * создания теста (владелец 16.09.2026: «было бы лучше сделать привязку к
 * конкретной кампании, получать список кампаний по nm_id и выбирать
 * нужную»). В отличие от campaign-forecast (авторезолюция с порогом
 * расхода за 14 дней), здесь весь список без фильтра по расходу — свежая
 * кампания без накрученного бюджета тоже должна быть видна сразу.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const sp = new URL(request.url).searchParams;
  const nmId = Number(sp.get("nm"));
  if (!Number.isInteger(nmId) || nmId <= 0) return fail("Некорректный nm", 400);
  const { cabinetId } = await resolveShopCabinet(sp.get("cabinet") ?? undefined);
  if (!cabinetId) return fail("Выберите один реальный WB-кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  const mode = sp.get("mode") === "unified" ? "unified" : "search_only";

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const candidates = await listCtrCampaignCandidates(db, cabinetId, nmId, mode);
  return NextResponse.json({ data: { candidates }, error: null });
}
