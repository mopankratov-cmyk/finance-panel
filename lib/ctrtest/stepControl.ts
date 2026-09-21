import type { SupabaseClient } from "@supabase/supabase-js";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { restoreCampaignState } from "./campaignHold";
import { getAdvertStatus } from "./liveMetrics";
import { ADVERT_STATUS_BY_ACTION } from "@/lib/wb/advertApi";
import { partialStepResult, type EngineStep } from "./stepEngine";
import type { StepPhase } from "./stepMachine";

/**
 * Ручные действия над тестом нового движка: запуск, пауза, возобновление.
 *
 * SQL-функция `transition_ctr_test` знает только про прежнюю модель, где шаг
 * закрывается вместе с паузой и попадает в итоги как есть. У нового движка
 * шаг засчитывается только целиком, после устоявшейся статистики, поэтому пауза
 * и возобновление идут мимо неё: тест встаёт на паузу вместе со своим шагом,
 * а при возобновлении шаг начинается заново с фазы «смена фото».
 */

const ACTIVE = ADVERT_STATUS_BY_ACTION.start;
const PAUSED = ADVERT_STATUS_BY_ACTION.pause;
const columnMissing = (code?: string) => code === "42703" || code === "PGRST204";

export const STEP_ENGINE_MIGRATION = "202609220001_ctr_test_step_engine.sql";

export interface EngineFields {
  engineVersion: number;
  /** По раундам, id вариантов. */
  variantOrders: number[][] | null;
}

/** Версия движка и план теста. Колонок нет (миграция не применена) — это прежний движок. */
export async function readEngineFields(db: SupabaseClient, testId: number): Promise<EngineFields> {
  const { data, error } = await db.from("ctr_tests").select("engine_version, variant_orders").eq("id", testId).maybeSingle();
  if (error || !data) return { engineVersion: 1, variantOrders: null };
  return { engineVersion: Number(data.engine_version ?? 1), variantOrders: (data.variant_orders as number[][] | null) ?? null };
}

type Failure = { ok: false; error: string; status: number };

/**
 * Запуск теста нового движка: кампания должна быть привязана и в понятном
 * статусе, а её состояние до теста запоминается — в него она вернётся.
 * Возвращает вариант, с которого начинается план.
 */
export async function prepareStepEngineStart(
  db: SupabaseClient,
  input: { testId: number; cabinetId: string; advertId: number | null; orders: number[][] | null },
): Promise<{ ok: true; variantId: number } | Failure> {
  if (input.advertId == null) {
    return { ok: false, status: 409, error: "Для этого теста нет привязанной поисковой кампании — без неё панель не может ни запустить показы, ни остановить их, когда цель набрана. Выберите кампанию в мастере или дождитесь, пока она появится на артикуле." };
  }
  const variantId = input.orders?.[0]?.[0];
  if (variantId == null) return { ok: false, status: 409, error: "У теста нет плана: не задан порядок вариантов по раундам." };

  const cabinet = await getWbCabinet(input.cabinetId);
  const token = cabinet ? resolveWbToken(cabinet, "advert") : null;
  if (!token) return { ok: false, status: 409, error: "Нет токена Продвижения — управлять кампанией теста нечем." };

  // Живой статус, а не из таблицы: `wb_adverts` обновляется синком раз в час.
  let before = await getAdvertStatus(token, input.advertId);
  if (before == null) {
    const { data } = await db.from("wb_adverts").select("status").eq("advert_id", input.advertId).eq("cabinet_id", input.cabinetId).maybeSingle();
    before = data?.status == null ? null : Number(data.status);
  }
  if (before !== ACTIVE && before !== PAUSED) {
    return { ok: false, status: 409, error: `Кампания сейчас в состоянии, из которого её нельзя вести между «идёт» и «пауза» (статус ${before ?? "неизвестен"}). Запустите её вручную и повторите.` };
  }
  const saved = await db.from("ctr_tests").update({ campaign_status_before: before, campaign_restore_pending: false, campaign_restore_error: null }).eq("id", input.testId);
  if (saved.error) {
    return columnMissing(saved.error.code)
      ? { ok: false, status: 503, error: `Примените миграцию ${STEP_ENGINE_MIGRATION}.` }
      : { ok: false, status: 500, error: saved.error.message };
  }
  return { ok: true, variantId };
}

type TestRow = Record<string, unknown>;
type ControlResult = { ok: true; test: TestRow | null } | Failure;

/** Пауза: тест встаёт вместе со своим шагом, в итоги ничего не попадает. */
export async function pauseStepEngineTest(db: SupabaseClient, testId: number, actor: string | null): Promise<ControlResult> {
  const { data, error } = await db.from("ctr_tests")
    .update({ status: "paused", auto_error: null, updated_at: new Date().toISOString() })
    .eq("id", testId).eq("status", "running").select().maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 409, error: "Тест не запущен." };
  await db.from("ctr_test_events").insert({ test_id: testId, action: "pause", actor, details: { engine: 2 } });
  return { ok: true, test: data as TestRow };
}

/**
 * Возобновление: шаг, на котором тест встал, начинается заново. Его замеры не
 * дописываются — цифры до паузы и после неё сравнивать нечестно, — а фото
 * кладётся снова: неизвестно, что стояло на витрине к моменту паузы.
 * `handled: false` — идущего шага нет (тест встал на потолке расхода), дальше
 * работает обычный путь через SQL.
 */
export async function resumeStepEngineTest(
  db: SupabaseClient,
  testId: number,
  actor: string | null,
): Promise<{ handled: false } | ({ handled: true } & ControlResult)> {
  const { data: step } = await db.from("ctr_test_rounds").select("id, variant_id, detail").eq("test_id", testId).eq("status", "active").maybeSingle();
  if (!step) return { handled: false };

  const { data: test } = await db.from("ctr_tests").select("status, spend_cap_rub").eq("id", testId).maybeSingle();
  if (test?.status !== "paused") return { handled: true, ok: false, status: 409, error: "Тест не на паузе." };
  const { data: variants } = await db.from("ctr_variants").select("spend").eq("test_id", testId);
  const spent = (variants ?? []).reduce((sum, row) => sum + Number(row.spend ?? 0), 0);
  if (spent >= Number(test.spend_cap_rub ?? Infinity)) return { handled: true, ok: false, status: 409, error: "Лимит расходов выбран — запускать тест дальше нельзя." };

  const previous = (step.detail ?? {}) as { attempts?: number };
  const phase: StepPhase = "swap";
  const patched = await db.from("ctr_test_rounds")
    .update({ phase, phase_at: new Date().toISOString(), detail: { attempts: (previous.attempts ?? 0) + 1, failStreak: 0, lastError: null } })
    .eq("id", step.id);
  if (patched.error) return { handled: true, ok: false, status: 500, error: patched.error.message };

  const { data: updated, error } = await db.from("ctr_tests")
    .update({ status: "running", current_variant_id: step.variant_id, auto_error: null, updated_at: new Date().toISOString() })
    .eq("id", testId).eq("status", "paused").select().maybeSingle();
  if (error) return { handled: true, ok: false, status: 500, error: error.message };
  await db.from("ctr_test_events").insert({ test_id: testId, action: "start", actor, details: { variantId: step.variant_id, resumed: true, engine: 2 } });
  return { handled: true, ok: true, test: (updated as TestRow | null) ?? null };
}

/** Результат идущего шага для досрочного закрытия человеком — по журналу самого шага. */
export type ActiveStepResult =
  | { kind: "error"; error: string }
  | { kind: "missing" }
  | { kind: "ok"; result: ReturnType<typeof partialStepResult> };

export async function activeStepResult(db: SupabaseClient, testId: number): Promise<ActiveStepResult> {
  const { data, error } = await db.from("ctr_test_rounds").select("id, variant_id, pass_no, phase, baseline, detail").eq("test_id", testId).eq("status", "active").maybeSingle();
  if (error) return { kind: "error", error: error.message };
  if (!data) return { kind: "missing" };
  return {
    kind: "ok",
    result: partialStepResult({
      id: String(data.id),
      variant_id: Number(data.variant_id),
      pass_no: data.pass_no == null ? null : Number(data.pass_no),
      phase: (data.phase as StepPhase | null) ?? null,
      baseline: (data.baseline as EngineStep["baseline"]) ?? null,
      detail: (data.detail as EngineStep["detail"]) ?? null,
    }),
  };
}

/** Вернуть кампанию теста в состояние до теста: после паузы, стопа, отмены. */
export async function restoreCampaignForTest(
  db: SupabaseClient,
  test: { id: number; cabinetId: string; advertId: number | null },
  actor: string,
): Promise<string> {
  const cabinet = await getWbCabinet(test.cabinetId);
  const token = cabinet ? resolveWbToken(cabinet, "advert") : null;
  if (!token) return "failed: нет токена Продвижения";
  const outcome = await restoreCampaignState(db, { id: test.id, cabinet_id: test.cabinetId, advert_id: test.advertId }, token, actor);
  return outcome.status === "failed" ? `failed: ${outcome.error}` : outcome.status === "skipped" ? `skipped: ${outcome.reason}` : outcome.status;
}
