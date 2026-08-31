import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { loadStrategies, runRepricer, persistDecisions } from "@/lib/repricer/run";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/repricer/run?cabinet= — прогнать репрайсер и записать решения за сегодня.
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const requestedCabinet = new URL(request.url).searchParams.get("cabinet");
  const { cabinetId } = await resolveShopCabinet(requestedCabinet ?? undefined);
  if (!cabinetId) {
    return NextResponse.json({ error: "Для прогона выберите один WB-кабинет" }, { status: 400 });
  }
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const strategies = await loadStrategies();
  if (!strategies.length) {
    return NextResponse.json({ error: "Нет стратегий — применена ли миграция 20260626_repricer.sql?" }, { status: 400 });
  }
  const rows = await runRepricer(cabinetId, strategies);
  const runDate = new Date().toISOString().slice(0, 10);
  // Запись решений теперь может упасть вслух — раньше сбой вставки терялся, и
  // прогон отвечал «предложений столько-то» поверх пустой таблицы.
  try {
    const proposed = await persistDecisions(runDate, cabinetId, rows);
    return NextResponse.json({ runDate, cabinet: cabinetId, total: rows.length, proposed, skipped: rows.length - proposed });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Не удалось сохранить решения репрайсера" },
      { status: 502 },
    );
  }
}
