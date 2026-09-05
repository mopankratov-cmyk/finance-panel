import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { ctrProductBelongsToCabinet, getCtrMetricSnapshot } from "@/lib/ctrtest/metrics";
import { ctrSnapshotDelta, ctrVariantScore, normalizeCtrCreatePayload, type CtrTestType, type CtrVariantTotals } from "@/lib/ctrtest/model";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const migrationMissing = (code?: string) => ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code ?? "");

async function selected(raw: string | null) {
  if (!raw || raw === "all" || raw.startsWith("group:")) return null;
  return (await resolveShopCabinet(raw)).cabinetId;
}

function publicVariant(row: Record<string, unknown>, type: CtrTestType, baselineScore: number | null) {
  const totals: CtrVariantTotals = {
    id: Number(row.id),
    position: Number(row.position),
    label: String(row.label ?? ""),
    isBaseline: Boolean(row.is_baseline),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    spend: Number(row.spend ?? 0),
    opens: Number(row.opens ?? 0),
    carts: Number(row.carts ?? 0),
    orders: Number(row.orders ?? 0),
    roundsCount: Number(row.rounds_count ?? 0),
    roundsWon: Number(row.rounds_won ?? 0),
  };
  const score = ctrVariantScore(type, totals);
  const resultPct = score !== null && baselineScore !== null && baselineScore > 0 ? Math.round((score - baselineScore) / baselineScore * 10_000) / 100 : null;
  return {
    ...totals,
    imageUrl: String(row.image_url ?? ""),
    source: String(row.source ?? ""),
    isWinner: Boolean(row.is_winner),
    score,
    resultPct,
  };
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const cabinetId = await selected(new URL(request.url).searchParams.get("cabinet"));
  if (!cabinetId) return fail("Выберите один реальный WB-кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const { data: rawTests, error } = await db.from("ctr_tests").select("id, cabinet_id, nm_id, article, name, status, test_type, interval_min, impressions_per_round, target_impressions, spend_cap_rub, live_swap_enabled, auto_error, round_num, current_variant_id, winner_variant_id, winner_explanation, source_test_id, started_at, finished_at, created_by, created_at, updated_at").eq("cabinet_id", cabinetId).order("created_at", { ascending: false }).limit(100);
  if (error) return fail(migrationMissing(error.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : error.message, migrationMissing(error.code) ? 503 : 500);
  const ids = (rawTests ?? []).map((row) => Number(row.id));
  if (!ids.length) return NextResponse.json({ data: { tests: [] }, error: null });

  const [variantResult, roundResult, eventResult] = await Promise.all([
    db.from("ctr_variants").select("id, test_id, label, image_url, source, is_winner, position, is_baseline, impressions, clicks, spend, opens, carts, orders, rounds_count, rounds_won").in("test_id", ids).order("position"),
    db.from("ctr_test_rounds").select("id, test_id, variant_id, round_number, status, baseline, result, close_reason, actor, started_at, ended_at").in("test_id", ids).order("started_at", { ascending: false }).limit(500),
    db.from("ctr_test_events").select("id, test_id, action, actor, details, created_at").in("test_id", ids).order("created_at", { ascending: false }).limit(500),
  ]);
  const nestedError = variantResult.error ?? roundResult.error ?? eventResult.error;
  if (nestedError) return fail(migrationMissing(nestedError.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : nestedError.message, migrationMissing(nestedError.code) ? 503 : 500);

  const variantsByTest = new Map<number, Record<string, unknown>[]>();
  for (const row of variantResult.data ?? []) {
    const id = Number(row.test_id);
    const list = variantsByTest.get(id) ?? [];
    list.push(row as Record<string, unknown>);
    variantsByTest.set(id, list);
  }
  const roundsByTest = new Map<number, Record<string, unknown>[]>();
  for (const row of roundResult.data ?? []) {
    const id = Number(row.test_id);
    const list = roundsByTest.get(id) ?? [];
    list.push(row as Record<string, unknown>);
    roundsByTest.set(id, list);
  }
  const eventsByTest = new Map<number, Record<string, unknown>[]>();
  for (const row of eventResult.data ?? []) {
    const id = Number(row.test_id);
    const list = eventsByTest.get(id) ?? [];
    list.push(row as Record<string, unknown>);
    eventsByTest.set(id, list);
  }

  const running = (rawTests ?? []).filter((test) => test.status === "running").slice(0, 20);
  const liveByTest = new Map<number, ReturnType<typeof ctrSnapshotDelta>>();
  await Promise.all(running.map(async (test) => {
    const active = (roundsByTest.get(Number(test.id)) ?? []).find((round) => round.status === "active");
    if (!active) return;
    try {
      const current = await getCtrMetricSnapshot(cabinetId, Number(test.nm_id));
      liveByTest.set(Number(test.id), ctrSnapshotDelta((active.baseline ?? {}) as Record<string, unknown>, current));
    } catch { /* сохранённые метрики остаются доступны даже при временной ошибке WB-среза */ }
  }));

  const tests = (rawTests ?? []).map((row) => {
    const type = String(row.test_type) as CtrTestType;
    const rawVariants = variantsByTest.get(Number(row.id)) ?? [];
    const baselineRow = rawVariants.find((variant) => variant.is_baseline) ?? rawVariants[0];
    const baselineTotals = baselineRow ? publicVariant(baselineRow, type, null) : null;
    const baselineScore = baselineTotals?.score ?? null;
    return {
      id: Number(row.id),
      cabinetId,
      nmId: Number(row.nm_id),
      article: String(row.article ?? row.nm_id),
      name: String(row.name ?? ""),
      status: String(row.status),
      testType: type,
      intervalMin: Number(row.interval_min),
      impressionsPerRound: Number(row.impressions_per_round),
      targetImpressions: Number(row.target_impressions),
      spendCapRub: Number(row.spend_cap_rub),
      liveSwapEnabled: Boolean(row.live_swap_enabled),
      autoError: (row.auto_error as string | null) ?? null,
      roundNum: Number(row.round_num),
      currentVariantId: row.current_variant_id == null ? null : Number(row.current_variant_id),
      winnerVariantId: row.winner_variant_id == null ? null : Number(row.winner_variant_id),
      winnerExplanation: row.winner_explanation ? String(row.winner_explanation) : null,
      sourceTestId: row.source_test_id == null ? null : Number(row.source_test_id),
      variants: rawVariants.map((variant) => publicVariant(variant, type, baselineScore)),
      rounds: roundsByTest.get(Number(row.id)) ?? [],
      history: eventsByTest.get(Number(row.id)) ?? [],
      currentLive: liveByTest.get(Number(row.id)) ?? null,
      startedAt: row.started_at ?? null,
      finishedAt: row.finished_at ?? null,
      createdBy: row.created_by ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
  return NextResponse.json({ data: { tests }, error: null });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return fail("Некорректное тело запроса", 400);
  const normalized = normalizeCtrCreatePayload(body);
  if (!normalized.ok) return fail(normalized.error, 400);
  const cabinetId = await selected(normalized.value.cabinetId);
  if (!cabinetId || cabinetId !== normalized.value.cabinetId) return fail("Выберите один реальный WB-кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);

  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  if (allowedNmIds !== null && !allowedNmIds.has(normalized.value.nmId)) return fail("SKU не входит в разрешённый товарный контур кабинета", 403);
  if (!(await ctrProductBelongsToCabinet(cabinetId, normalized.value.nmId))) return fail("SKU не найден в данных выбранного кабинета", 404);
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  if (normalized.value.sourceTestId) {
    const { data: source } = await db.from("ctr_tests").select("id").eq("id", normalized.value.sourceTestId).eq("cabinet_id", cabinetId).maybeSingle();
    if (!source) return fail("Исходный тест маховика не найден в этом кабинете", 400);
  }
  const session = await getServerSession();
  const { data: id, error } = await db.rpc("create_ctr_test", {
    p_test: { ...normalized.value, liveSwapEnabled: false },
    p_actor: session?.email ?? null,
  });
  if (error) return fail(migrationMissing(error.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : error.message, migrationMissing(error.code) ? 503 : 500);
  return NextResponse.json({ data: { id: Number(id) }, error: null }, { status: 201 });
}
