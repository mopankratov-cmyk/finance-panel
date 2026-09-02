import { NextRequest, NextResponse } from "next/server";

import { auditAdvertOperation, resolveAdvertCabinetContext } from "@/lib/adverts/cabinetGuard";
import { depositAllowance, judgeDeposit } from "@/lib/adverts/depositLimits";
import { DEPOSIT_SOURCE_LABEL, depositAdvertBudget, getAdvertConfig, type DepositSource } from "@/lib/wb/advertApi";

export const dynamic = "force-dynamic";

const SOURCES: DepositSource[] = [0, 1, 3];

/**
 * Пополнение бюджета кампании — единственное действие модуля, которое двигает
 * деньги и не отменяется: вернуть сумму из бюджета кампании обратно на счёт WB
 * не умеет.
 *
 * Поэтому здесь четыре проверки подряд, и порядок у них не случайный: сначала
 * то, что не стоит ни одного запроса наружу (права, форма запроса), потом
 * минимум и лимиты, и только в самом конце — сеть. Отказ должен стоить дёшево.
 *
 * Отклонённые попытки пишутся в журнал наравне с успешными. Три отказа подряд
 * по суточному лимиту — это разговор с человеком, а не строка, которую стоит
 * потерять.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const advertId: number | null = typeof body.advertId === "number" ? body.advertId : null;
  const sum: number = Number(body.sum);
  const source = (typeof body.type === "number" ? body.type : 1) as DepositSource;

  if (!advertId) return NextResponse.json({ error: "Нужен advertId" }, { status: 400 });
  if (!SOURCES.includes(source)) {
    return NextResponse.json({ error: "Неизвестный источник пополнения" }, { status: 400 });
  }

  // Причина словами человека — необязательна, пишется в журнал как есть.
  const reason = typeof body.reason === "string" ? body.reason : null;
  const resolved = await resolveAdvertCabinetContext({ cabinetId: body.cabinetId, advertIds: [advertId] });
  if (resolved.response) return resolved.response;
  const context = resolved.context;

  // Минимальную сумму называет сам WB и она зависит от валюты кабинета.
  // Константа «минимум 50» здесь была бы выдумкой для любого нерублёвого счёта.
  const config = await getAdvertConfig(context.token);
  if (!config.ok) {
    return NextResponse.json(
      { error: `Не удалось узнать условия кабинета: ${config.message}` },
      { status: config.status === 0 ? 500 : 502 },
    );
  }
  const minTopUp = config.data.minTopUp / 100;

  const allowance = await depositAllowance(context.db, context.cabinet.id);
  const verdict = judgeDeposit({ sum, minTopUp, allowance });
  if (!verdict.allowed) {
    await auditAdvertOperation({
      context,
      reason,
      advertId,
      action: "deposit",
      status: "rejected",
      oldValue: { spentToday: allowance.spentToday },
      newValue: { sum, type: source },
      wbResult: verdict.reason,
    });
    return NextResponse.json({ error: verdict.reason, allowance }, { status: 400 });
  }

  const result = await depositAdvertBudget(context.token, advertId, sum, source);
  if (!result.ok) {
    await auditAdvertOperation({
      context,
      reason,
      advertId,
      action: "deposit",
      status: "error",
      oldValue: { spentToday: allowance.spentToday },
      newValue: { sum, type: source },
      wbResult: result.raw ?? result.message,
    });
    return NextResponse.json({ error: result.message }, { status: result.status === 0 ? 500 : 502 });
  }

  await auditAdvertOperation({
    context,
    reason,
    advertId,
    action: "deposit",
    status: "ok",
    oldValue: { spentToday: allowance.spentToday },
    newValue: { sum, type: source, source: DEPOSIT_SOURCE_LABEL[source] },
    wbResult: result.data,
  });

  return NextResponse.json({
    ok: true,
    advertId,
    sum,
    source: DEPOSIT_SOURCE_LABEL[source],
    total: result.data?.total ?? null,
    allowance: { ...allowance, spentToday: allowance.spentToday + sum, remainingToday: allowance.remainingToday - sum },
  });
}
