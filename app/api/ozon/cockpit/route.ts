import { NextRequest, NextResponse } from "next/server";
import { describeOzonScope, getOzonCabinetScope } from "@/lib/ozon/cabinet";
import type { OzonCockpitView } from "@/lib/ozon/cockpit";
import { loadCachedOzonCockpit } from "@/lib/ozon/cockpitCache";
import { resolveOzonPeriod } from "@/lib/ozon/period";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VIEWS = new Set<OzonCockpitView>(["overview", "sales", "adverts", "stocks", "orders", "economy", "health"]);

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const rawView = params.get("view") || "overview";
  if (!VIEWS.has(rawView as OzonCockpitView)) {
    return NextResponse.json({ error: "Неизвестный экран Ozon" }, { status: 400 });
  }
  // Период приходит либо календарём (from/to), либо по старому — числом дней.
  const period = resolveOzonPeriod(params.get("from"), params.get("to"), Number(params.get("days")) || 14);
  const taxPct = Math.min(30, Math.max(0, Number(params.get("tax")) || 7));
  const resolved = await getOzonCabinetScope(params.get("cabinet"));
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error, noCabinet: true }, { status: 404 });
  }
  try {
    const data = await loadCachedOzonCockpit({
      view: rawView as OzonCockpitView,
      scope: describeOzonScope(resolved.scope),
      days: period.days,
      from: period.from,
      to: period.to,
      taxPct,
    }, { forceRefresh: params.get("refresh") === "1" });
    return NextResponse.json(data, { headers: { "X-Dashboard-Cache": "hourly-snapshot" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось собрать Ozon Cockpit" },
      { status: 502 },
    );
  }
}
