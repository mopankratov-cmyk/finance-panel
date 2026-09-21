import type { SupabaseClient } from "@supabase/supabase-js";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { restoreCampaignState } from "./campaignHold";
import { resumeShelfPausesForTest } from "./campaignBinding";
import { restoreOriginalCover } from "./originalCover";
import { runStepTick, type EngineStep, type EngineTest } from "./stepEngine";
import { makeStepIo, makeSupabaseStepStore } from "./stepAdapters";
import type { StepPhase } from "./stepMachine";

/**
 * Проход крона по тестам нового движка (`ctr_tests.engine_version = 2`).
 *
 * Прежние тесты идут прежним путём в app/api/ctrtest/rotate: их не переводим на
 * лету, у них другая шкала метрик (дневные агрегаты из базы), и смена движка
 * посреди замера смешала бы два способа счёта в одном тесте.
 */

export interface ReportLine { testId: number; outcome: string; detail?: string }

const ENGINE_COLUMNS = "id, cabinet_id, nm_id, advert_id, impressions_per_round, dead_zone_min, max_step_min, settle_max_min, settle_stable_reads, variant_orders, auto_error";
const columnMissing = (code?: string) => code === "42703" || code === "PGRST204";

export async function runStepEngineTests(db: SupabaseClient, report: ReportLine[], restoreAttempted: Set<number>): Promise<Set<number>> {
  const handled = new Set<number>();
  const { data, error } = await db.from("ctr_tests").select(ENGINE_COLUMNS)
    .eq("status", "running").eq("live_swap_enabled", true).eq("engine_version", 2);
  // Ошибка колонки — миграция 202609220001 ещё не применена: движка нет, всё идёт по-старому.
  if (error) {
    if (!columnMissing(error.code)) report.push({ testId: 0, outcome: "новый движок: не прочитать тесты", detail: error.message });
    return handled;
  }

  const store = makeSupabaseStepStore(db);
  for (const row of data ?? []) {
    const test = row as unknown as EngineTest & { auto_error: string | null };
    handled.add(test.id);
    let tickError: string | null = null;
    try {
      const cabinet = await getWbCabinet(test.cabinet_id);
      if (!cabinet) { report.push({ testId: test.id, outcome: "кабинет не найден" }); tickError = "кабинет не найден"; continue; }
      const contentToken = resolveWbToken(cabinet, "content");
      const advertToken = resolveWbToken(cabinet, "advert");
      if (!advertToken) { report.push({ testId: test.id, outcome: "нет токена Продвижения" }); tickError = "нет токена Продвижения — управлять кампанией нечем"; continue; }

      const { data: stepRow } = await db.from("ctr_test_rounds")
        .select("id, variant_id, pass_no, phase, baseline, detail").eq("test_id", test.id).eq("status", "active").maybeSingle();
      if (!stepRow) { report.push({ testId: test.id, outcome: "нет идущего шага" }); tickError = "у работающего теста нет идущего шага"; continue; }

      const io = makeStepIo(db, { contentToken, advertToken, actor: "ctr-rotate" });
      const step: EngineStep = {
        id: String(stepRow.id),
        variant_id: Number(stepRow.variant_id),
        pass_no: stepRow.pass_no == null ? null : Number(stepRow.pass_no),
        phase: (stepRow.phase as StepPhase | null) ?? null,
        baseline: (stepRow.baseline as EngineStep["baseline"]) ?? null,
        detail: (stepRow.detail as EngineStep["detail"]) ?? null,
      };
      const result = await runStepTick(test, step, io, store);
      report.push({ testId: test.id, outcome: result.note, detail: result.detail });
      tickError = result.error;

      // Тест вышел из работы — витрина и кампания возвращаются владельцу.
      if (result.testStatus) {
        restoreAttempted.add(test.id);
        const held = { id: test.id, cabinet_id: test.cabinet_id, advert_id: test.advert_id };
        const campaign = await restoreCampaignState(db, held, advertToken, "ctr-rotate");
        report.push({ testId: test.id, outcome: `возврат кампании: ${campaign.status}`, detail: campaign.status === "failed" ? campaign.error : undefined });
        if (result.testStatus === "done" || result.testStatus === "cancelled") {
          await resumeShelfPausesForTest(db, { testId: test.id, token: advertToken, actorEmail: "ctr-rotate" });
          const cover = await restoreOriginalCover(db, { id: test.id, nm_id: test.nm_id }, contentToken, "ctr-rotate");
          report.push({ testId: test.id, outcome: `возврат обложки: ${cover.status}`, detail: cover.status === "failed" ? cover.error : undefined });
        }
      }
    } catch (cause) {
      tickError = cause instanceof Error ? cause.message : String(cause);
      report.push({ testId: test.id, outcome: "сбой", detail: tickError });
    } finally {
      // Отметка попытки при любом исходе: молчащая автоматика неотличима от сломанной.
      // Тест, поставленный на паузу этим проходом, причину уже несёт (pauseTest).
      await db.from("ctr_tests").update({ auto_checked_at: new Date().toISOString(), auto_error: tickError }).eq("id", test.id);
    }
  }

  // Кампании, которые тест остановил, а вернуть с первого раза не вышло, — по кругу, пока не вернутся.
  const pending = await db.from("ctr_tests").select("id, cabinet_id, nm_id, advert_id")
    .in("status", ["paused", "done", "cancelled"]).eq("campaign_restore_pending", true).limit(20);
  for (const row of pending.error ? [] : (pending.data ?? [])) {
    const testId = Number(row.id);
    if (restoreAttempted.has(testId)) continue;
    try {
      const cabinet = await getWbCabinet(String(row.cabinet_id));
      const token = cabinet ? resolveWbToken(cabinet, "advert") : null;
      if (!token) { report.push({ testId, outcome: "возврат кампании: нет токена Продвижения" }); continue; }
      const campaign = await restoreCampaignState(db, { id: testId, cabinet_id: String(row.cabinet_id), advert_id: row.advert_id == null ? null : Number(row.advert_id) }, token, "ctr-rotate");
      report.push({ testId, outcome: `возврат кампании: ${campaign.status}`, detail: campaign.status === "failed" ? campaign.error : undefined });
    } catch (cause) {
      report.push({ testId, outcome: "возврат кампании: сбой", detail: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return handled;
}
