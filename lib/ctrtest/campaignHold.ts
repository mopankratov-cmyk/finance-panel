import type { SupabaseClient } from "@supabase/supabase-js";
import { ADVERT_STATUS_BY_ACTION, setAdvertLifecycle } from "@/lib/wb/advertApi";
import { getAdvertStatus } from "./liveMetrics";

/**
 * Управление кампанией теста: реклама останавливается, когда шаг набрал цель, и
 * запускается на следующем — иначе статистика не устоится (пока кампания
 * крутится, счётчики растут всегда).
 *
 * КАМПАНИЯ ПРИНАДЛЕЖИТ ВЛАДЕЛЬЦУ, А НЕ ТЕСТУ. Тест трогает только ту кампанию,
 * что привязана к нему (`ctr_tests.advert_id`), и только между двумя статусами
 * — «идёт» (9) и «пауза» (11). На старте запоминается, в каком статусе она
 * была, а при любом выходе из работы (пауза, конец, отмена) возвращается в него.
 * Пока возврат не подтверждён, стоит метка `campaign_restore_pending`, и крон
 * повторяет попытку: остановленная и забытая кампания — это потерянные продажи.
 */

const ACTIVE = ADVERT_STATUS_BY_ACTION.start;
const PAUSED = ADVERT_STATUS_BY_ACTION.pause;

export type HoldResult = { ok: true } | { ok: false; error: string };

interface HeldTest { id: number; cabinet_id: string; advert_id: number | null }

const statusName = (status: number | null) => (status === ACTIVE ? "идёт" : status === PAUSED ? "на паузе" : `статус ${status ?? "неизвестен"}`);

async function audit(db: SupabaseClient, test: HeldTest, actor: string, action: string, from: number | null, to: number, detail: string) {
  await db.from("advert_bid_changes").insert({
    advert_id: test.advert_id,
    cabinet_id: test.cabinet_id,
    user_email: actor,
    action,
    old_value: from,
    new_value: to,
    status: "ok",
    detail: `CTR-тест #${test.id}: ${detail}`,
  });
}

async function setStatus(
  db: SupabaseClient,
  test: HeldTest,
  token: string,
  actor: string,
  target: number,
  reason: string,
): Promise<HoldResult> {
  if (test.advert_id == null) return { ok: false, error: "у теста нет привязанной кампании" };
  const before = await getAdvertStatus(token, test.advert_id);
  if (before === target) return { ok: true };
  // Кампания завершена, отклонена или ещё не запускалась: между «идёт» и
  // «пауза» её не перекинуть, а решать за владельца, что с ней делать, тест не вправе.
  if (before !== ACTIVE && before !== PAUSED) {
    return { ok: false, error: `кампания сейчас в состоянии «${statusName(before)}» — тест её не трогает` };
  }
  const result = await setAdvertLifecycle(token, test.advert_id, target === ACTIVE ? "start" : "pause");
  if (!result.ok) return { ok: false, error: result.message };
  await db.from("wb_adverts").update({ status: target }).eq("advert_id", test.advert_id).eq("cabinet_id", test.cabinet_id);
  await audit(db, test, actor, target === ACTIVE ? "ctr_step_start" : "ctr_step_pause", before, target, reason);
  // Метка ставится ПОСЛЕ смены статуса, но до возврата: провал возврата виден.
  await db.from("ctr_tests").update({ campaign_restore_pending: true }).eq("id", test.id);
  return { ok: true };
}

/** Шаг начинается: реклама должна идти. */
export const startCampaignForStep = (db: SupabaseClient, test: HeldTest, token: string, actor: string) =>
  setStatus(db, test, token, actor, ACTIVE, "запуск рекламы на шаг");

/** Шаг набрал цель: реклама на паузу, статистика должна устояться. */
export const pauseCampaignForStep = (db: SupabaseClient, test: HeldTest, token: string, actor: string) =>
  setStatus(db, test, token, actor, PAUSED, "пауза после набора целевых показов, ждём устоявшейся статистики");

export type CampaignRestoreOutcome =
  | { status: "restored" }
  | { status: "skipped"; reason: "nothing-pending" | "migration-missing" }
  | { status: "failed"; error: string };

/**
 * Вернуть кампанию в то состояние, в котором она была до теста.
 *
 * Идемпотентна: пока метка `campaign_restore_pending` стоит, повтор допустим.
 * Кампанию, что была на паузе ещё до теста, на паузе и оставляем — включать то,
 * что владелец выключил сам, тест не вправе.
 */
export async function restoreCampaignState(
  db: SupabaseClient,
  test: HeldTest,
  token: string,
  actor: string,
): Promise<CampaignRestoreOutcome> {
  const { data, error } = await db.from("ctr_tests")
    .select("campaign_status_before, campaign_restore_pending").eq("id", test.id).maybeSingle();
  if (error) {
    return error.code === "42703" || error.code === "PGRST204"
      ? { status: "skipped", reason: "migration-missing" }
      : { status: "failed", error: error.message };
  }
  if (!data?.campaign_restore_pending) return { status: "skipped", reason: "nothing-pending" };

  const target = Number(data.campaign_status_before) === PAUSED ? PAUSED : ACTIVE;
  if (test.advert_id == null) return { status: "failed", error: "у теста нет привязанной кампании" };

  const current = await getAdvertStatus(token, test.advert_id);
  if (current !== target) {
    if (current !== ACTIVE && current !== PAUSED) {
      const error = `кампания сейчас в состоянии «${statusName(current)}» — вернуть её в прежнее состояние нельзя`;
      await db.from("ctr_tests").update({ campaign_restore_error: error }).eq("id", test.id);
      return { status: "failed", error };
    }
    const result = await setAdvertLifecycle(token, test.advert_id, target === ACTIVE ? "start" : "pause");
    if (!result.ok) {
      await db.from("ctr_tests").update({ campaign_restore_error: result.message }).eq("id", test.id);
      return { status: "failed", error: result.message };
    }
    await db.from("wb_adverts").update({ status: target }).eq("advert_id", test.advert_id).eq("cabinet_id", test.cabinet_id);
    await audit(db, test, actor, target === ACTIVE ? "ctr_step_resume" : "ctr_step_pause", current, target, "возврат кампании в состояние до теста");
  }
  await db.from("ctr_tests").update({ campaign_restore_pending: false, campaign_restore_error: null }).eq("id", test.id);
  return { status: "restored" };
}
