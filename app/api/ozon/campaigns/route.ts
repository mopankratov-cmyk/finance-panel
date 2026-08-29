import { NextRequest, NextResponse } from "next/server";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { perfCampaigns, type PerfCampaign } from "@/lib/ozon/performance";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Кампании кабинета: что вообще сейчас крутится.
 *
 * Рекомендации экрана «Реклама» («снизить на 30%», «поставить на паузу»)
 * до сих пор было не на что применить: список кампаний в интерфейсе
 * отсутствовал, и менеджер уходил в кабинет Ozon искать нужную вручную.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const resolved = await getOzonCabinetScope(params.get("cabinet"));
  if (!resolved.ok) return NextResponse.json({ error: resolved.error, noCabinet: true }, { status: 404 });

  const warnings: string[] = [];
  const rows: Array<PerfCampaign & { cabinet: string; cabinetId: string }> = [];
  await Promise.all(resolved.scope.cabinets.map(async (cabinet) => {
    if (!cabinet.perf) {
      warnings.push(`${cabinet.name}: Performance API не подключён`);
      return;
    }
    const result = await perfCampaigns(cabinet.perf);
    if (!result.ok) {
      warnings.push(`${cabinet.name}: ${result.error}`);
      return;
    }
    for (const campaign of result.campaigns) {
      rows.push({ ...campaign, cabinet: cabinet.name, cabinetId: cabinet.id });
    }
  }));

  // Работающие — наверх: именно они тратят деньги прямо сейчас.
  rows.sort((left, right) => Number(right.running) - Number(left.running)
    || (right.dailyBudget ?? 0) - (left.dailyBudget ?? 0)
    || left.title.localeCompare(right.title, "ru-RU"));

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    scope: { label: resolved.scope.label, count: resolved.scope.cabinets.length },
    summary: {
      total: rows.length,
      running: rows.filter((row) => row.running).length,
      dailyBudget: rows.filter((row) => row.running).reduce((sum, row) => sum + (row.dailyBudget ?? 0), 0),
    },
    rows,
    warnings,
  });
}
