import { NextRequest, NextResponse } from "next/server";

import { auditAdvertOperation, resolveAdvertCabinetContext } from "@/lib/adverts/cabinetGuard";
import { activeCtrTestForCampaign, ctrFreezeMessage } from "@/lib/ctrtest/freeze";
import { ADVERT_STATUS_BY_ACTION, setAdvertLifecycle, type AdvertLifecycleAction } from "@/lib/wb/advertApi";

export const dynamic = "force-dynamic";

function isLifecycleAction(value: unknown): value is AdvertLifecycleAction {
  return value === "start" || value === "pause" || value === "stop";
}

/**
 * Запуск, пауза и завершение кампании.
 *
 * Переведено на общий клиент Продвижения. Раньше роут ходил в WB сам и отдавал
 * наружу сырой ответ — и живая проверка 01.09.2026 показала, чего это стоит:
 * на попытку паузы WB вернул
 * `{"status":403,...,"detail":"read-only token cannot perform non-readonly requests"}`,
 * и ровно этот JSON человек и увидел в диалоге подтверждения. Перевод такого
 * отказа в понятную фразу в клиенте уже был написан — просто этот роут мимо
 * него ходил.
 *
 * Причина, по которой это важнее обычной опрятности: 403 здесь чинится за
 * минуту перевыпуском ключа без галочки «Только на чтение». Пока причина не
 * названа словами, человек ищет поломку в панели.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const advertId: number | null = typeof body.advertId === "number" ? body.advertId : null;
  const action: unknown = body.action;

  if (!advertId || !isLifecycleAction(action)) {
    return NextResponse.json({ error: "Неверные параметры (advertId/action)" }, { status: 400 });
  }
  // Причина словами человека — необязательна, пишется в журнал как есть.
  const reason = typeof body.reason === "string" ? body.reason : null;
  const resolved = await resolveAdvertCabinetContext({ cabinetId: body.cabinetId, advertIds: [advertId] });
  if (resolved.response) return resolved.response;
  const context = resolved.context;

  // Заморозка на время CTR-теста (ТЗ владельца 15.09.2026): совпадает только
  // с кампанией, реально привязанной к тесту (advert_id, Фаза A) — не с любой,
  // что когда-либо крутила этот артикул, иначе автопауза «полок» самого теста
  // (она идёт в обход этого роута — lib/ctrtest/campaignBinding.ts) рисковала
  // бы задеть себя же.
  const lock = await activeCtrTestForCampaign(context.db, context.cabinet.id, advertId);
  if (lock) return NextResponse.json({ error: ctrFreezeMessage(lock) }, { status: 409 });

  const status = ADVERT_STATUS_BY_ACTION[action];
  const oldStatus = context.adverts.get(advertId)?.status ?? null;

  const result = await setAdvertLifecycle(context.token, advertId, action);
  if (!result.ok) {
    await auditAdvertOperation({
      context,
      reason,
      advertId,
      action,
      status: "error",
      oldValue: oldStatus,
      newValue: status,
      // В журнал уходит сырой ответ WB: разбирать спорный случай через неделю
      // проще по нему, а не по нашему пересказу. Человеку показывается пересказ.
      wbResult: result.raw ?? result.message,
    });
    return NextResponse.json({ error: result.message }, { status: result.status === 0 ? 500 : 502 });
  }

  // Оптимистично обновляем статус в Supabase, чтобы UI не ждал ресинка.
  await context.db.from("wb_adverts").update({ status }).eq("advert_id", advertId).eq("cabinet_id", context.cabinet.id);
  await auditAdvertOperation({ context, reason, advertId, action, status: "ok", oldValue: oldStatus, newValue: status, wbResult: result.data });

  return NextResponse.json({ ok: true, advertId, status });
}
