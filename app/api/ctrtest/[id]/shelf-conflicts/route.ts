import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { findCompetingShelfCampaigns, pauseShelfCampaigns } from "@/lib/ctrtest/campaignBinding";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const migrationMissing = (code?: string) => ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code ?? "");

interface TestLookup { id: number; cabinet_id: string; nm_id: number; test_type: string; advert_id: number | null; shelf_conflict_state: string }

async function loadTest(db: ReturnType<typeof getSupabaseAdmin>, id: number): Promise<{ test: TestLookup | null; response?: NextResponse }> {
  if (!db) return { test: null, response: fail("Supabase не настроен", 500) };
  const { data, error } = await db
    .from("ctr_tests")
    .select("id, cabinet_id, nm_id, test_type, advert_id, shelf_conflict_state")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return { test: null, response: fail(migrationMissing(error.code) ? "Примените миграцию 202609150004_ctr_test_campaign_binding.sql" : error.message, migrationMissing(error.code) ? 503 : 500) };
  }
  if (!data?.cabinet_id) return { test: null, response: fail("Тест не найден", 404) };
  return { test: data as TestLookup };
}

/**
 * Конкурирующие полочные кампании на артикуле теста — детект и текущее
 * решение человека. Отдельный роут, не новый `action`: побочный эффект над
 * рекламными кампаниями не место тащить через `transition_ctr_test`,
 * итак трижды переписанную ради самого теста (lib/ctrtest/campaignBinding.ts).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return fail("Некорректный id теста", 400);
  const db = getSupabaseAdmin();
  const { test, response } = await loadTest(db, id);
  if (response) return response;
  if (!(await hasCabinetAccess(test!.cabinet_id))) return fail("Нет доступа к кабинету", 403);
  if (test!.test_type !== "ctr") return NextResponse.json({ data: { state: "none", candidates: [] }, error: null });

  const candidates = await findCompetingShelfCampaigns(db!, test!.cabinet_id, Number(test!.nm_id), test!.advert_id);
  return NextResponse.json({ data: { state: test!.shelf_conflict_state, candidates }, error: null });
}

/**
 * Решение человека: поставить найденные полки на паузу, или осознанно
 * продолжить без паузы. Кандидатов пересчитываем на сервере заново — не
 * доверяем списку из тела запроса (устареет между показом и кликом, или
 * будет подделан). Уровень доступа — тот же, что у тумблера «автосмена»
 * (app/api/ctrtest/[id]/action/route.ts): пауза расхода не менее
 * необратима по духу, чем запись в карточку.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(["director", "wb_manager"]);
  if (gate) return gate;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return fail("Некорректный id теста", 400);
  const body = await request.json().catch(() => null) as { decision?: string } | null;
  const decision = body?.decision;
  if (decision !== "pause" && decision !== "decline") return fail("decision должен быть pause или decline", 400);

  const db = getSupabaseAdmin();
  const { test, response } = await loadTest(db, id);
  if (response) return response;
  if (!(await hasCabinetAccess(test!.cabinet_id))) return fail("Нет доступа к кабинету", 403);
  if (test!.test_type !== "ctr") return fail("Конфликт полок применим только к CTR-тестам", 400);

  const session = await getServerSession();
  const actorEmail = session?.email ?? "—";
  const now = new Date().toISOString();

  if (decision === "decline") {
    await db!.from("ctr_tests").update({ shelf_conflict_state: "declined", shelf_conflict_checked_at: now, shelf_conflict_resolved_by: actorEmail }).eq("id", id);
    return NextResponse.json({ data: { state: "declined", paused: [], failed: [] }, error: null });
  }

  const cabinet = await getWbCabinet(test!.cabinet_id);
  const token = cabinet ? resolveWbToken(cabinet, "advert") : null;
  if (!token) return fail("У кабинета нет токена Продвижения — поставить полки на паузу нечем", 400);

  const candidates = await findCompetingShelfCampaigns(db!, test!.cabinet_id, Number(test!.nm_id), test!.advert_id);
  const { paused, failed } = await pauseShelfCampaigns(db!, { testId: id, cabinetId: test!.cabinet_id, token, candidates, actorEmail });
  // Состояние — "confirmed" даже при частичном отказе WB: решение принято,
  // а что не получилось — видно в `failed`, чтобы поставить на паузу руками.
  await db!.from("ctr_tests").update({ shelf_conflict_state: "confirmed", shelf_conflict_checked_at: now, shelf_conflict_resolved_by: actorEmail }).eq("id", id);
  return NextResponse.json({ data: { state: "confirmed", paused, failed }, error: null });
}
