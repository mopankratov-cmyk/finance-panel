import { NextRequest, NextResponse } from "next/server";

import { auditAdvertOperation, resolveAdvertCabinetContext } from "@/lib/adverts/cabinetGuard";
import { ADVERT_STATUS_BY_ACTION, setAdvertLifecycle, type AdvertLifecycleAction } from "@/lib/wb/advertApi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Мягкая пауза между кампаниями: лимит WB считается на аккаунт продавца, а не
// на кампанию, и пачка без пауз упирается в него на середине.
const PAUSE_MS = 700;

function isLifecycleAction(value: unknown): value is AdvertLifecycleAction {
  return value === "start" || value === "pause" || value === "stop";
}

/**
 * Массовое действие над набором кампаний.
 *
 * Как и одиночный роут, переведено на общий клиент Продвижения — раньше здесь
 * наружу уходило `WB 403` без объяснения, и в пачке это особенно неудобно:
 * сорок одинаковых «WB 403» не говорят, что причина одна и общая.
 *
 * Отказ по правам токена прекращает прогон сразу. Продолжать смысла нет: если
 * ключ выпущен только на чтение, следующие сорок запросов получат тот же ответ,
 * потратив лимит WB и засорив журнал сорока одинаковыми строками.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.advertIds)
    ? body.advertIds.filter((value: unknown): value is number => typeof value === "number")
    : [];
  const action: unknown = body.action;

  if (!ids.length || !isLifecycleAction(action)) {
    return NextResponse.json({ error: "Неверные параметры (advertIds/action)" }, { status: 400 });
  }
  // Причина словами человека — необязательна, пишется в журнал как есть.
  const reason = typeof body.reason === "string" ? body.reason : null;
  const resolved = await resolveAdvertCabinetContext({ cabinetId: body.cabinetId, advertIds: ids });
  if (resolved.response) return resolved.response;
  const context = resolved.context;

  const status = ADVERT_STATUS_BY_ACTION[action];
  const results: Array<{ advertId: number; ok: boolean; error?: string }> = [];
  let stoppedEarly: string | null = null;

  for (let index = 0; index < ids.length; index++) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    const advertId = ids[index];
    const oldStatus = context.adverts.get(advertId)?.status ?? null;

    const result = await setAdvertLifecycle(context.token, advertId, action);
    if (result.ok) {
      await context.db.from("wb_adverts").update({ status }).eq("advert_id", advertId).eq("cabinet_id", context.cabinet.id);
      await auditAdvertOperation({ context, reason, advertId, action, status: "ok", oldValue: oldStatus, newValue: status, wbResult: result.data });
      results.push({ advertId, ok: true });
      continue;
    }

    await auditAdvertOperation({
      context,
      reason,
      advertId,
      action,
      status: "error",
      oldValue: oldStatus,
      newValue: status,
      wbResult: result.raw ?? result.message,
    });
    results.push({ advertId, ok: false, error: result.message });

    if (result.forbidden) {
      stoppedEarly = result.message;
      break;
    }
  }

  const okCount = results.filter((item) => item.ok).length;
  const ok = okCount === ids.length;
  return NextResponse.json(
    {
      ok,
      total: ids.length,
      success: okCount,
      failed: results.length - okCount,
      // Сколько кампаний вообще не пробовали: молчать об этом нельзя, иначе
      // «обработано 3 из 40» читается как «37 не удалось».
      skipped: ids.length - results.length,
      stoppedEarly,
      results,
    },
    { status: ok ? 200 : 502 },
  );
}
