import { NextRequest, NextResponse } from "next/server";

import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 60;

const RETENTION_DAYS = 90;

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const cutoff = new Date(startedAt.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  // Удаляем пачками, а не одним запросом.
  //
  // Прежний вариант — одно удаление по всему диапазону, да ещё с точным
  // пересчётом строк — падал по statement timeout четыре ночи подряд,
  // причём удалять было НЕЧЕГО:
  // строк старше 90 дней в таблице нет. Валил его сам масштаб — 1,4 млн строк
  // без индекса по snapshot_at, а точный пересчёт заставлял пройти её целиком.
  // Точное число удалённых тут не нужно никому: считаем то, что реально
  // удалили, и не платим за пересчёт таблицы.
  const BATCH = 1_000;
  const MAX_BATCHES = 40;
  // Бюджет времени меньше maxDuration: лучше честно доложить о недоделанной
  // чистке, чем быть убитым платформой на середине и не записать ничего.
  const DEADLINE_MS = 45_000;

  try {
    let deleted = 0;
    let drained = false;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      if (Date.now() - startedAt.getTime() > DEADLINE_MS) break;
      const { data: stale, error: pickError } = await db
        .from("wb_stocks_history")
        .select("id")
        .lt("snapshot_at", cutoff)
        .order("id", { ascending: true })
        .limit(BATCH);
      if (pickError) throw new Error(`Очистка wb_stocks_history: ${pickError.message}`);
      const ids = (stale ?? []).map((row) => (row as { id: number }).id);
      if (!ids.length) { drained = true; break; }
      const { error: deleteError } = await db.from("wb_stocks_history").delete().in("id", ids);
      if (deleteError) throw new Error(`Очистка wb_stocks_history: ${deleteError.message}`);
      deleted += ids.length;
    }

    // Не дочистили — это отдельное состояние, а не успех: следующий прогон
    // должен знать, что хвост остался, и человек — тоже.
    const note = drained ? null : `Чистка не завершена: за прогон удалено ${deleted}, хвост остался — следующий прогон продолжит`;
    await writeSyncLog("stocks-history-cleanup", drained ? "ok" : "partial", deleted, note, startedAt);
    return NextResponse.json({ ok: true, deleted, drained, cutoff });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    await writeSyncLog("stocks-history-cleanup", "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
