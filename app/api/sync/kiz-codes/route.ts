import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { fetchFbsOrders, fetchFbsOrderMeta } from "@/lib/wb/fbsMarketplace";
import { loadKnownKizCodes, rememberKizCodes } from "@/lib/wb/fbsKizStore";

// Коды маркировки добираются в фоне, а не по заходу пользователя.
//
// WB отдаёт код по одному заданию за запрос, а лимитер общий на кабинет: пока
// коды опрашивал открытый экран, он конкурировал с почасовыми синками — и
// проигрывал. Замер 23.08.2026: три захода подряд упирались в 429 даже с
// паузой в две минуты. Здесь лимит времени 300 секунд и никто не ждёт ответа,
// поэтому опрос идёт медленно и с запасом.
export const maxDuration = 300;

/** Сколько заданий добираем за прогон на кабинет. */
const CODES_PER_RUN = 200;
/** Пауза между запросами: у WB лимит на кабинет, спешить некуда. */
const REQUEST_PAUSE_MS = 350;
const WINDOW_DAYS = 14;

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const targets = await getWbSyncTargets();
  const summary: Array<{ cabinet: string; probed: number; found: number; left: number; error?: string }> = [];
  const deadline = Date.now() + 260_000;

  for (const target of targets) {
    if (!target.cabinetId) continue;
    if (Date.now() > deadline) break;
    try {
      const { orders } = await fetchFbsOrders(target.advertToken, {
        fromMs: Date.now() - WINDOW_DAYS * 86_400_000,
        toMs: Date.now(),
        deadlineMs: deadline,
      });
      const ids = orders.map((order) => order.id).filter((id) => Number.isFinite(id));
      if (!ids.length) {
        summary.push({ cabinet: target.name, probed: 0, found: 0, left: 0 });
        continue;
      }

      const known = await loadKnownKizCodes(target.cabinetId, ids);
      const queue = ids.filter((id) => !known.codes.get(id)?.length && !known.recentlyProbed.has(id));
      const probed = new Map<number, string[]>();
      let found = 0;

      for (const id of queue.slice(0, CODES_PER_RUN)) {
        if (Date.now() > deadline) break;
        try {
          const meta = await fetchFbsOrderMeta(target.advertToken, id);
          const codes = [...meta.sgtin, ...meta.uin, ...meta.imei, ...meta.gtin].filter(Boolean);
          // Пустой ответ тоже пишем — как отметку «спрашивали», не как «кода нет».
          probed.set(id, codes);
          if (codes.length) found += 1;
        } catch {
          // Одно упавшее задание не должно рвать прогон: попробуем в следующий раз.
        }
        await new Promise((resolve) => setTimeout(resolve, REQUEST_PAUSE_MS));
      }

      await rememberKizCodes(target.cabinetId, probed);
      summary.push({
        cabinet: target.name,
        probed: probed.size,
        found,
        left: Math.max(0, queue.length - probed.size),
      });
    } catch (error) {
      summary.push({
        cabinet: target.name,
        probed: 0,
        found: 0,
        left: 0,
        error: error instanceof Error ? error.message.slice(0, 120) : "Не удалось добрать коды",
      });
    }
  }

  const failed = summary.filter((row) => row.error);
  const note = summary
    .map((row) => `${row.cabinet}: +${row.found} из ${row.probed}${row.left ? `, в очереди ${row.left}` : ""}${row.error ? ` · ${row.error}` : ""}`)
    .join("; ");
  await writeSyncLog("kiz-codes", failed.length ? "error" : "ok", summary.reduce((sum, row) => sum + row.probed, 0), note || null, startedAt);
  return NextResponse.json({ ok: failed.length === 0, summary });
}
