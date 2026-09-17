import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { ensureCtrTestCampaignBinding, resumeShelfPausesForTest } from "@/lib/ctrtest/campaignBinding";
import { getCtrMetricSnapshot } from "@/lib/ctrtest/metrics";
import { CTR_FORCE_HINT, ctrSnapshotDelta, type CtrMetricSnapshot } from "@/lib/ctrtest/model";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fail = (error: string, status: number, details?: unknown) => NextResponse.json({ data: details ? { details } : null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code ?? "");

/**
 * Правила финала живут в SQL, а человек читал их английский текст исключения.
 * Переводим ровно те случаи, которые он может исправить сам.
 */
function humanTransitionError(message: string): string {
  const weakest = message.match(/the weakest (?:variant )?has (\d+)/)?.[1];
  const target = message.match(/of (\d+) target impressions/)?.[1];
  if (/not enough data/.test(message)) {
    return `Данных мало: каждому откручённому варианту нужно минимум 50 показов (или открытий карточки), у слабейшего ${weakest ?? "меньше"}. На таком объёме доля — шум, а не измерение.`;
  }
  if (/unequal exposure/.test(message)) {
    const idle = message.match(/and (\d+) variant\(s\) were never shown/)?.[1];
    const idleText = idle && idle !== "0" ? ` Ни разу не откручено вариантов: ${idle}.` : "";
    return `${CTR_FORCE_HINT} У слабейшего откручённого варианта ${weakest ?? "?"} показов из ${target ?? "?"} по норме.${idleText}`;
  }
  if (/no variant has been shown yet/.test(message)) {
    return "Ни один вариант ещё не крутился — сравнивать нечего.";
  }
  if (/only one variant has been shown/.test(message)) {
    return "Крутился только один вариант: тест из одного — это не сравнение. Дайте открутиться хотя бы второму.";
  }
  if (/no variant reached the minimum denominator/.test(message)) {
    return "Ни один вариант не добрал минимального знаменателя — победителя объявить не из чего.";
  }
  if (/test is already closed/.test(message)) return "Тест уже закрыт.";
  if (/spend cap reached/.test(message)) return "Лимит расходов выбран — запускать тест дальше нельзя.";
  if (/test is not running/.test(message)) return "Тест не запущен.";
  if (/active round not found/.test(message)) return "У работающего теста нет активного раунда.";
  return message;
}
const confirmations: Record<string, string> = {
  start: "CONTENT_IS_SET",
  advance: "CONTENT_IS_SET",
  finish: "FINISH_TEST",
  cancel: "CANCEL_TEST",
  winner: "SELECT_WINNER",
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return fail("Некорректный id теста", 400);
  const body = await request.json().catch(() => null) as { action?: string; variantId?: number; confirm?: string; explanation?: string; force?: boolean } | null;
  const action = String(body?.action ?? "");
  if (!["start", "advance", "pause", "finish", "cancel", "winner"].includes(action)) return fail("Неизвестное действие", 400);
  if (confirmations[action] && body?.confirm !== confirmations[action]) return fail("Нужно явное подтверждение действия", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  // Колонки Фазы A (advert_id/shelf_conflict_state, 202609150004) и режима
  // кампании (campaign_mode, 202609160002) накатываются владельцем отдельно
  // от выкладки кода. Откат на более старый список полей, а не 500, пока не
  // применены.
  let test: { id: number; cabinet_id: string; nm_id: number; status: string; test_type: string; round_num: number; advert_id: number | null; shelf_conflict_state: string; campaign_mode: string } | null = null;
  {
    const withMode = await db.from("ctr_tests").select("id, cabinet_id, nm_id, status, test_type, round_num, advert_id, shelf_conflict_state, campaign_mode").eq("id", id).maybeSingle();
    if (withMode.error?.code === "42703") {
      const full = await db.from("ctr_tests").select("id, cabinet_id, nm_id, status, test_type, round_num, advert_id, shelf_conflict_state").eq("id", id).maybeSingle();
      if (full.error?.code === "42703") {
        const legacy = await db.from("ctr_tests").select("id, cabinet_id, nm_id, status, test_type, round_num").eq("id", id).maybeSingle();
        if (legacy.error) return fail(missingMigration(legacy.error.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : legacy.error.message, missingMigration(legacy.error.code) ? 503 : 500);
        test = legacy.data ? { ...legacy.data, advert_id: null, shelf_conflict_state: "unchecked", campaign_mode: "search_only" } : null;
      } else if (full.error) {
        return fail(missingMigration(full.error.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : full.error.message, missingMigration(full.error.code) ? 503 : 500);
      } else {
        test = full.data ? { ...full.data, campaign_mode: "search_only" } : null;
      }
    } else if (withMode.error) {
      return fail(missingMigration(withMode.error.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : withMode.error.message, missingMigration(withMode.error.code) ? 503 : 500);
    } else {
      test = withMode.data;
    }
  }
  if (!test?.cabinet_id) return fail("Тест не найден", 404);
  const cabinetId = String(test.cabinet_id);
  const nmId = Number(test.nm_id);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  if (allowedNmIds !== null && !allowedNmIds.has(nmId)) return fail("SKU больше не входит в товарный контур кабинета", 403);

  /**
   * Раунды у автоматического теста переключает крон, а не человек.
   *
   * Раньше это стояло в SQL и там же ломало всё остальное: запрет накрывал и
   * запуск, и паузу, и отмену — владелец не мог прервать то, что панель делает
   * с витриной. Теперь запрет узкий и стоит здесь, потому что гейт в базе
   * действия не знает. Слабее, чем в SQL, и держится на том, что у ручного
   * пути ровно один вызывающий — этот роут. Крона база останавливает сама.
   *
   * Срабатывает только у тестов старше 15.09.2026 (владелец отменил ручной
   * режим): у них ещё может стоять `live_swap_enabled = false` с прошлого —
   * новые тесты этот флаг больше никогда не несут.
   */
  if (action === "advance") {
    const { data: mode } = await db.from("ctr_tests").select("live_swap_enabled").eq("id", id).maybeSingle();
    if (mode?.live_swap_enabled) {
      return fail("Раунды переключает автоматика — у новых тестов ручного режима больше нет", 409);
    }
  }

  // Резолюция поисковой кампании — один раз, пока у теста ещё не было ни
  // одного раунда; дальше функция сама no-op (lib/ctrtest/campaignBinding.ts).
  const binding = await ensureCtrTestCampaignBinding(db, {
    id: test.id,
    cabinetId,
    nmId,
    testType: test.test_type,
    roundNum: test.round_num,
    advertId: test.advert_id,
    shelfConflictState: test.shelf_conflict_state,
    campaignMode: test.campaign_mode === "unified" ? "unified" : "search_only",
  });

  /**
   * Ручного режима больше нет (решение владельца 15.09.2026): старт теста
   * сразу и необратимо включает автосмену — раньше это был отдельный шаг
   * («тумблер auto»), требовавший director/wb_manager и разобранных полок.
   * Оба условия переехали сюда без ослабления: старт теперь ровно настолько
   * же необратимое действие, каким раньше был тот тумблер, — крон начнёт
   * писать в живую карточку по итогам именно этого шага.
   */
  if (action === "start") {
    const roleGate = await requireApiSession(["director", "wb_manager"]);
    if (roleGate) return roleGate;
    if (test.test_type === "ctr" && !["none", "confirmed", "declined"].includes(binding.shelfConflictState)) {
      return fail("Сначала разберитесь с конкурирующими полочными кампаниями на этом артикуле — список в карточке теста (GET .../shelf-conflicts).", 409);
    }
  }

  let snapshot: CtrMetricSnapshot;
  try { snapshot = await getCtrMetricSnapshot(cabinetId, nmId, binding.advertId); }
  catch (cause) { return fail(cause instanceof Error ? cause.message : "Не удалось снять метрики", 502); }

  let result: ReturnType<typeof ctrSnapshotDelta> | Record<string, never> = {};
  if (test.status === "running") {
    const { data: active, error: activeError } = await db.from("ctr_test_rounds").select("baseline").eq("test_id", id).eq("status", "active").maybeSingle();
    if (activeError) return fail(activeError.message, 500);
    if (!active) return fail("У работающего теста нет активного раунда", 409);
    result = ctrSnapshotDelta((active.baseline ?? {}) as Partial<CtrMetricSnapshot>, snapshot);
  }

  const session = await getServerSession();
  const { data, error: transitionError } = await db.rpc("transition_ctr_test", {
    p_input: {
      testId: id,
      action,
      variantId: body?.variantId ?? null,
      snapshot,
      result,
      explanation: String(body?.explanation ?? "").slice(0, 2_000),
      // Закрыть тест, когда варианты открутились неодинаково, можно только
      // осознанно: SQL иначе откажет, и в объяснении победителя останется
      // пометка, что норма добрана не всеми.
      force: body?.force === true,
    },
    p_actor: session?.email ?? null,
  });
  if (transitionError) {
    if (missingMigration(transitionError.code)) {
      return fail("Примените миграции CTR-тестов из supabase/migrations (202608310001, 202608310002, 202609010001)", 503, { result });
    }
    return fail(humanTransitionError(transitionError.message), 409, { result });
  }
  // Что произошло на самом деле. Раньше упор в потолок расхода возвращал
  // ровно тот же успех, что обычный переход, и человек не узнавал, что тест
  // встал: HTTP 200 и нейтральный тост.
  const status = (data as { status?: string } | null)?.status ?? null;
  const outcome = action === "advance" && status === "paused" ? "cap_paused"
    : action === "advance" && status === "done" ? "cap_finished"
    : action;

  // Тест перешёл в running первым запуском — включаем автосмену. Роль и
  // заслон по полкам уже пройдены гейтом выше; сама запись — после успеха
  // transition_ctr_test, а не до: неудавшийся старт не должен оставлять флаг
  // включённым на тесте, который так и не побежал.
  if (action === "start") {
    await db.from("ctr_tests").update({ live_swap_enabled: true, auto_error: null }).eq("id", id);
  }

  // Автовозврат полок — тест дошёл до конца (явным finish/cancel, или
  // advance упёрся в потолок расхода и SQL закрыл его сам). Не на
  // cap_paused: паузу тест может снять позже, полки должны остаться
  // выключенными до тех пор.
  if (test.test_type === "ctr" && (status === "done" || status === "cancelled")) {
    const cabinet = await getWbCabinet(cabinetId);
    const token = cabinet ? resolveWbToken(cabinet, "advert") : null;
    if (token) {
      await resumeShelfPausesForTest(db, { testId: id, token, actorEmail: session?.email ?? "ctr-test" });
    }
  }

  return NextResponse.json({ data: { test: data, result, outcome }, error: null });
}
