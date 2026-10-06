import type { SupabaseClient } from "@supabase/supabase-js";
import { moscowToday, shiftIsoDay } from "@/lib/sync/moscowDay";
import { engineWeek, type EngineWeek } from "./engineBudget";
import { isMissingAssortmentSchema } from "./errors";

/**
 * Чтение и запись сквозного учёта расхода движка (`assortment_ai_usage`, миграция 202610050005). Без таблицы чтение отвечает null —
 * вызывающий решает сам (разбор по фото и рилсы без учёта не платят вовсе, Bright Data — по прежнему правилу без потолка).
 */

const USAGE = "assortment_ai_usage";

function missing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || isMissingAssortmentSchema(new Error(error.message ?? ""));
}

/** Первый день недели учёта: скользящие 7 московских суток, сегодня включительно (как у бюджета разбора по фото). */
export function engineWeekSince(now: Date | number): string {
  return shiftIsoDay(moscowToday(now), -6);
}

/** Расход движка за 7 суток по статьям. null — таблицы учёта нет; сбой чтения — исключение (платить вслепую нельзя). */
export async function loadEngineWeek(db: SupabaseClient, now: Date | number = new Date()): Promise<EngineWeek | null> {
  const { data, error } = await db.from(USAGE).select("day,kind,cost_usd").gte("day", engineWeekSince(now));
  if (error) {
    if (missing(error)) return null;
    throw new Error(`учёт расхода движка не прочитался: ${error.message}`);
  }
  return engineWeek((data ?? []) as Array<{ kind: string; cost_usd: number | string | null }>);
}

export interface EngineUsageAdd {
  /** Единицы оплаты: вызовы ИИ, записи выборки, запросы анлокера. */
  calls: number;
  failed?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
}

/**
 * Прибавить расход статьи к дневной строке. Сравнение-и-замена по updated_at (как у разбора по фото и рилсов): параллельный писатель
 * между чтением и записью не затирается — проигравший перечитывает строку и прибавляет заново. Без таблицы — тихо ничего.
 */
export async function addEngineUsage(db: SupabaseClient, now: Date | number, kind: string, add: EngineUsageAdd): Promise<void> {
  if (add.calls <= 0 && (add.failed ?? 0) <= 0 && add.costUsd <= 0) return;
  const day = moscowToday(now);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await db.from(USAGE).select("calls,failed_calls,input_tokens,output_tokens,cost_usd,updated_at").eq("day", day).eq("kind", kind).maybeSingle();
    if (error) {
      if (missing(error)) return;
      throw new Error(error.message);
    }
    const prev = (data ?? null) as { calls?: number; failed_calls?: number; input_tokens?: number | string; output_tokens?: number | string; cost_usd?: number | string; updated_at?: string } | null;
    const next = {
      calls: Number(prev?.calls ?? 0) + Math.max(0, Math.round(add.calls)),
      failed_calls: Number(prev?.failed_calls ?? 0) + Math.max(0, Math.round(add.failed ?? 0)),
      input_tokens: Number(prev?.input_tokens ?? 0) + Math.max(0, Math.round(add.inputTokens ?? 0)),
      output_tokens: Number(prev?.output_tokens ?? 0) + Math.max(0, Math.round(add.outputTokens ?? 0)),
      cost_usd: Math.round((Number(prev?.cost_usd ?? 0) + Math.max(0, add.costUsd)) * 100_000) / 100_000,
      updated_at: new Date().toISOString(),
    };
    if (!prev) {
      const { error: insertError } = await db.from(USAGE).insert({ day, kind, ...next });
      if (!insertError) return;
      if ((insertError as { code?: string }).code !== "23505") throw new Error(insertError.message);
      continue; // строку успел создать другой писатель — перечитаем и прибавим
    }
    const { data: updated, error: updateError } = await db.from(USAGE).update(next).eq("day", day).eq("kind", kind).eq("updated_at", prev.updated_at).select("day");
    if (updateError) throw new Error(updateError.message);
    if (updated && updated.length > 0) return;
  }
  throw new Error("учёт расхода не записался: строку постоянно обновляет другой прогон");
}
