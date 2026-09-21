import type { SupabaseClient } from "@supabase/supabase-js";
import { moscowToday, shiftIsoDay } from "@/lib/sync/moscowDay";
import { fetchCardForWrite } from "@/lib/wb/cards";
import { replaceCardCover } from "@/lib/wb/media";
import { pauseCampaignForStep, startCampaignForStep } from "./campaignHold";
import { getLiveCtrSnapshot } from "./liveMetrics";
import type { StepIo, StepStore } from "./stepEngine";

/**
 * Настоящие Supabase и WB под интерфейсы движка (lib/ctrtest/stepEngine.ts).
 * Логики здесь нет: она в движке и проверяется тестами без сети.
 */

const fail = (message: string): never => { throw new Error(message); };

export function makeSupabaseStepStore(db: SupabaseClient): StepStore {
  return {
    async variantUrls(testId) {
      const { data, error } = await db.from("ctr_variants").select("id, image_url").eq("test_id", testId);
      if (error) fail(error.message);
      return new Map((data ?? []).map((row) => [Number(row.id), String(row.image_url ?? "")]));
    },

    async closedSteps(testId) {
      const { count, error } = await db.from("ctr_test_rounds")
        .select("id", { count: "exact", head: true }).eq("test_id", testId).eq("status", "closed");
      if (error) fail(error.message);
      return count ?? 0;
    },

    async patchStep(stepId, patch) {
      const { error } = await db.from("ctr_test_rounds").update(patch).eq("id", stepId);
      if (error) fail(error.message);
    },

    async closeStep(input) {
      // `auto` — у теста с включённой автосменой раунды закрывает только крон.
      // `force` — план выполнен: если у слабейшего варианта не набралась норма
      // (вышло время шага), SQL всё равно закроет тест и допишет недобор в
      // объяснение победителя, а не запрёт тест навсегда.
      const { data, error } = await db.rpc("transition_ctr_test", {
        p_input: {
          testId: input.testId,
          action: input.action,
          variantId: input.variantId,
          snapshot: input.snapshot,
          result: input.result,
          auto: true,
          force: true,
        },
        p_actor: "ctr-rotate",
      });
      if (error) fail(error.message);
      return { status: (data as { status?: string } | null)?.status ?? "running" };
    },

    async labelOpenedStep(testId, patch) {
      const { error } = await db.from("ctr_test_rounds").update(patch).eq("test_id", testId).eq("status", "active");
      if (error) fail(error.message);
    },

    async pauseTest(testId, reason) {
      // Только идущий тест: закрытый другим путём в паузу не возвращаем.
      const { error } = await db.from("ctr_tests")
        .update({ status: "paused", auto_error: reason, updated_at: new Date().toISOString() })
        .eq("id", testId).eq("status", "running");
      if (error) fail(error.message);
    },
  };
}

export function makeStepIo(db: SupabaseClient, ctx: { contentToken: string; advertToken: string; actor: string }): StepIo {
  return {
    now: () => Date.now(),
    todayMsk: () => moscowToday(),
    shiftDay: shiftIsoDay,

    async liveSnapshot(test, from, to) {
      if (test.advert_id == null) return { ok: false, error: "у теста нет привязанной кампании" };
      return getLiveCtrSnapshot({ token: ctx.advertToken, cabinetId: test.cabinet_id, nmId: test.nm_id, advertId: test.advert_id, from, to });
    },

    async swapPhoto(test, imageUrl) {
      // Карточку подтверждаем у WB перед записью: не нашли — не пишем.
      const card = await fetchCardForWrite(ctx.contentToken, test.nm_id);
      if (!card.found) return { ok: false, error: "WB не подтвердил карточку — запись отменена" };
      const write = await replaceCardCover(ctx.contentToken, test.nm_id, imageUrl);
      if (!write.ok) return { ok: false, error: write.error };
      // Витрина изменена: с этого момента при завершении теста исходную обложку
      // надо вернуть (lib/ctrtest/originalCover.ts).
      await db.from("ctr_tests").update({ cover_swapped_at: new Date().toISOString() }).eq("id", test.id).is("cover_swapped_at", null);
      return { ok: true };
    },

    startCampaign: (test) => startCampaignForStep(db, test, ctx.advertToken, ctx.actor),
    pauseCampaign: (test) => pauseCampaignForStep(db, test, ctx.advertToken, ctx.actor),
  };
}
