import { NextRequest, NextResponse } from "next/server";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { loadOzonCockpit, type OzonCockpitView } from "@/lib/ozon/cockpit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VIEWS = new Set<OzonCockpitView>(["overview", "sales", "adverts", "stocks", "orders", "economy", "health"]);

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const rawView = params.get("view") || "overview";
  if (!VIEWS.has(rawView as OzonCockpitView)) {
    return NextResponse.json({ error: "Неизвестный экран Ozon" }, { status: 400 });
  }
  const days = Math.min(30, Math.max(7, Number(params.get("days")) || 14));
  const taxPct = Math.min(30, Math.max(0, Number(params.get("tax")) || 7));
  const resolved = await getOzonCabinetScope(params.get("cabinet"));
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error, noCabinet: true }, { status: 404 });
  }
  try {
    const data = await loadOzonCockpit(rawView as OzonCockpitView, resolved.scope, days, taxPct);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось собрать Ozon Cockpit" },
      { status: 502 },
    );
  }
}
