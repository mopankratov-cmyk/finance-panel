import { NextRequest, NextResponse } from "next/server";
import { resolveWbCardCoverUrl } from "@/lib/wb/cardImage";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { listCtrCampaignCandidates } from "@/lib/ctrtest/campaignBinding";
import { needsPin, pinImageFromUrl, removePinned } from "@/lib/ctrtest/pinImage";
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

  const TEST_COLUMNS = "id, cabinet_id, nm_id, article, name, status, test_type, interval_min, impressions_per_round, target_impressions, spend_cap_rub, live_swap_enabled, auto_error, round_num, current_variant_id, winner_variant_id, winner_explanation, source_test_id, started_at, finished_at, created_by, created_at, updated_at";
  const CAMPAIGN_COLUMNS = "advert_id, shelf_conflict_state";
  const AI_COLUMNS = "ai_analysis, ai_analysis_generated_at";
  const MODE_COLUMN = "campaign_mode";
  let rawTests: Record<string, unknown>[] | null = null;
  {
    const withMode = await db.from("ctr_tests").select(`${TEST_COLUMNS}, ${CAMPAIGN_COLUMNS}, ${AI_COLUMNS}, ${MODE_COLUMN}`).eq("cabinet_id", cabinetId).order("created_at", { ascending: false }).limit(100);
    if (withMode.error?.code === "42703") {
      // Миграция режима кампании (202609160002, campaign_mode) ещё не
      // применена — пробуем без неё, дальше цепочка как раньше.
      const withAll = await db.from("ctr_tests").select(`${TEST_COLUMNS}, ${CAMPAIGN_COLUMNS}, ${AI_COLUMNS}`).eq("cabinet_id", cabinetId).order("created_at", { ascending: false }).limit(100);
      if (withAll.error?.code === "42703") {
        // Миграция Фазы D (202609150005, ai_analysis) ещё не применена —
        // пробуем без неё, с полями кампании/полок из Фазы A.
        const withCampaign = await db.from("ctr_tests").select(`${TEST_COLUMNS}, ${CAMPAIGN_COLUMNS}`).eq("cabinet_id", cabinetId).order("created_at", { ascending: false }).limit(100);
        if (withCampaign.error?.code === "42703") {
          // И миграция Фазы A (202609150004) тоже ещё не применена — список
          // работает как раньше, без полей кампании/полок/ИИ-разбора.
          const base = await db.from("ctr_tests").select(TEST_COLUMNS).eq("cabinet_id", cabinetId).order("created_at", { ascending: false }).limit(100);
          if (base.error) return fail(migrationMissing(base.error.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : base.error.message, migrationMissing(base.error.code) ? 503 : 500);
          rawTests = (base.data ?? []).map((row) => ({ ...row, advert_id: null, shelf_conflict_state: "unchecked", ai_analysis: null, ai_analysis_generated_at: null, campaign_mode: "search_only" }));
        } else if (withCampaign.error) {
          return fail(migrationMissing(withCampaign.error.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : withCampaign.error.message, migrationMissing(withCampaign.error.code) ? 503 : 500);
        } else {
          rawTests = (withCampaign.data ?? []).map((row) => ({ ...row, ai_analysis: null, ai_analysis_generated_at: null, campaign_mode: "search_only" }));
        }
      } else if (withAll.error) {
        return fail(migrationMissing(withAll.error.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : withAll.error.message, migrationMissing(withAll.error.code) ? 503 : 500);
      } else {
        rawTests = (withAll.data ?? []).map((row) => ({ ...row, campaign_mode: "search_only" }));
      }
    } else if (withMode.error) {
      return fail(migrationMissing(withMode.error.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : withMode.error.message, migrationMissing(withMode.error.code) ? 503 : 500);
    } else {
      rawTests = withMode.data;
    }
  }
  const ids = (rawTests ?? []).map((row) => Number(row.id));
  if (!ids.length) return NextResponse.json({ data: { tests: [] }, error: null });

  const [variantResult, roundResult, eventResult, coverResult] = await Promise.all([
    db.from("ctr_variants").select("id, test_id, label, image_url, source, is_winner, position, is_baseline, impressions, clicks, spend, opens, carts, orders, rounds_count, rounds_won").in("test_id", ids).order("position"),
    db.from("ctr_test_rounds").select("id, test_id, variant_id, round_number, status, baseline, result, close_reason, actor, started_at, ended_at").in("test_id", ids).order("started_at", { ascending: false }).limit(500),
    db.from("ctr_test_events").select("id, test_id, action, actor, details, created_at").in("test_id", ids).order("created_at", { ascending: false }).limit(500),
    // Колонки исходной обложки (202609210001) — отдельным запросом: пока
    // миграция не применена, ошибка колонки не должна ронять весь список.
    db.from("ctr_tests").select("id, original_cover_url, cover_swapped_at, cover_restored_at").in("id", ids),
  ]);
  const coverByTest = new Map<number, { original_cover_url: string | null; cover_swapped_at: string | null; cover_restored_at: string | null }>();
  for (const row of coverResult.error ? [] : coverResult.data ?? []) {
    coverByTest.set(Number(row.id), row as { original_cover_url: string | null; cover_swapped_at: string | null; cover_restored_at: string | null });
  }
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
      const advertId = test.advert_id == null ? null : Number(test.advert_id) || null;
      const current = await getCtrMetricSnapshot(cabinetId, Number(test.nm_id), advertId);
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
      advertId: row.advert_id == null ? null : Number(row.advert_id),
      shelfConflictState: String(row.shelf_conflict_state ?? "unchecked"),
      campaignMode: row.campaign_mode === "unified" ? "unified" : "search_only",
      aiAnalysis: (row.ai_analysis as { variants: { variantId: number; verdict: string }[]; recommendations: string[] } | null) ?? null,
      aiAnalysisGeneratedAt: (row.ai_analysis_generated_at as string | null) ?? null,
      originalCoverUrl: coverByTest.get(Number(row.id))?.original_cover_url ?? null,
      coverSwappedAt: coverByTest.get(Number(row.id))?.cover_swapped_at ?? null,
      coverRestoredAt: coverByTest.get(Number(row.id))?.cover_restored_at ?? null,
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
  /**
   * Ручной выбор кампании (владелец 16.09.2026: хочет сам выбирать, а не
   * только доверять авторезолюции) — не доверяем клиенту id как есть,
   * сверяем с тем же списком кандидатов, что отдаёт мастеру пикер. Так
   * нельзя подсунуть чужую кампанию или кампанию не того вида размещения
   * (полочную в режим "только поиск" и наоборот).
   */
  if (normalized.value.advertId != null && normalized.value.testType === "ctr") {
    const candidates = await listCtrCampaignCandidates(db, cabinetId, normalized.value.nmId, normalized.value.campaignMode);
    if (!candidates.some((candidate) => candidate.advertId === normalized.value.advertId)) {
      return fail("Выбранная кампания не найдена среди подходящих для этого режима на этом артикуле", 400);
    }
  }
  /**
   * Ссылку на текущее фото карточки чиним ЗДЕСЬ, а не доверяем клиенту.
   *
   * Мастер собирает её формулой `estimateBasket`, которая протухает при каждой
   * новой разрезке баскетов у WB: на живом тесте HT-83-26 формула дала
   * basket-48, а карточка лежит на basket-47 — в базу лёг мёртвый адрес, и
   * «Текущее фото» рисовалось битой картинкой. Это не косметика: при
   * автоматической ротации этот же адрес уходит в запись на карточку, и WB
   * либо откажет, либо заберёт пустоту.
   *
   * Спрашиваем настоящий баскет у WB один раз при создании — дальше ссылка
   * лежит верная.
   */
  const baseIndex = normalized.value.variants.findIndex((variant) => variant.source === "current");
  if (baseIndex >= 0 && normalized.value.variants[baseIndex].imageUrl) {
    const real = await resolveWbCardCoverUrl(normalized.value.nmId, normalized.value.variants[baseIndex].imageUrl);
    if (real) normalized.value.variants[baseIndex] = { ...normalized.value.variants[baseIndex], imageUrl: real };
  }

  /**
   * Каждую картинку теста закрепляем копией в нашем хранилище.
   *
   * Ссылка на фото карточки WB (`…/images/big/1.webp`) — адрес позиции, а не
   * файла: после замены обложки она отдаёт уже подставленный вариант, и вариант
   * «Текущее фото» не возвращается на витрину (lib/ctrtest/pinImage.ts). Файл у
   * нас не меняется. Не удалось скопировать — тест не создаём: иначе отказ
   * всплыл бы только в момент записи в живую карточку.
   */
  const pins = await Promise.all(normalized.value.variants.map((variant) =>
    needsPin(variant.imageUrl) ? pinImageFromUrl(db, { url: variant.imageUrl, cabinetId, nmId: normalized.value.nmId }) : null));
  const pinnedPaths = pins.flatMap((pin) => (pin?.ok ? [pin.path] : []));
  const pinFailure = pins.findIndex((pin) => pin !== null && !pin.ok);
  if (pinFailure >= 0) {
    await removePinned(db, pinnedPaths);
    const failed = pins[pinFailure] as { ok: false; error: string };
    return fail(`Вариант «${normalized.value.variants[pinFailure].label}»: ${failed.error}`, 502);
  }
  normalized.value.variants = normalized.value.variants.map((variant, index) => {
    const pin = pins[index];
    return pin?.ok ? { ...variant, imageUrl: pin.url } : variant;
  });

  const session = await getServerSession();
  const { data: id, error } = await db.rpc("create_ctr_test", {
    p_test: { ...normalized.value, liveSwapEnabled: false },
    p_actor: session?.email ?? null,
  });
  if (error) {
    await removePinned(db, pinnedPaths);
    return fail(migrationMissing(error.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : error.message, migrationMissing(error.code) ? 503 : 500);
  }
  /**
   * `create_ctr_test` помечает базой первый вариант по позиции. База — это фото,
   * которое уже стояло на карточке, и оно в тесте только если человек добавил
   * его сам (см. normalizeCtrCreatePayload). Выправляем флаги отдельной записью,
   * не трогая уже применённую RPC. Метка чисто справочная (подпись «база» на
   * экране и сноска о конверсии), поэтому сбой здесь создание не срывает.
   */
  await db.from("ctr_variants").update({ is_baseline: false }).eq("test_id", id);
  const basePositions = normalized.value.variants.flatMap((variant, index) => (variant.isBaseline ? [index] : []));
  if (basePositions.length) await db.from("ctr_variants").update({ is_baseline: true }).eq("test_id", id).in("position", basePositions);
  /**
   * `create_ctr_test` (SQL, 20260713_ctr_test_lifecycle.sql) не знает о
   * campaign_mode/advert_id — они появились позже (202609160002). Пишем
   * отдельным update, а не трогаем уже применённую RPC. При ручном выборе
   * кампании shelf_conflict_state НЕ трогаем здесь — его по-прежнему
   * проверяет ensureCtrTestCampaignBinding на первом "старте", свежими
   * данными, а не теми, что были на момент создания черновика.
   */
  if (normalized.value.testType === "ctr" && (normalized.value.campaignMode !== "search_only" || normalized.value.advertId != null)) {
    const update: Record<string, unknown> = { campaign_mode: normalized.value.campaignMode };
    if (normalized.value.advertId != null) update.advert_id = normalized.value.advertId;
    const { error: updateError } = await db.from("ctr_tests").update(update).eq("id", id);
    if (updateError && !migrationMissing(updateError.code)) return fail(updateError.message, 500);
  }
  return NextResponse.json({ data: { id: Number(id) }, error: null }, { status: 201 });
}
