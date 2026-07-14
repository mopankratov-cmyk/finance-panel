import { NextRequest, NextResponse } from "next/server";
import { listOzonScopeDescriptors } from "@/lib/ozon/cabinet";
import type { OzonCockpitView } from "@/lib/ozon/cockpit";
import { loadCachedOzonCockpit } from "@/lib/ozon/cockpitCache";
import {
  currentMoscowMonth,
  listWbRnpScopes,
  loadCachedWbRnp,
  WB_RNP_BACKGROUND_REFRESH,
} from "@/lib/rnp/tableCache";
import { checkCronAuth } from "@/lib/sync/helpers";
import { warmWbSecondaryDashboards } from "@/lib/wb/dashboardWarmup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VIEWS = new Set<OzonCockpitView>(["overview", "sales", "adverts", "stocks", "orders", "economy", "health"]);

async function warmWbRnp() {
  const startedAt = Date.now();
  const scopes = await listWbRnpScopes();
  const period = currentMoscowMonth();
  const snapshots: Array<{ scope: string; ok: boolean; generatedAt?: string; error?: string }> = [];
  const warm = async (scope: (typeof scopes)[number]) => {
    try {
      await loadCachedWbRnp({ ...period, ...scope }, WB_RNP_BACKGROUND_REFRESH);
      snapshots.push({ scope: scope.label, ok: true, generatedAt: new Date().toISOString(), error: undefined });
    } catch (error) {
      snapshots.push({ scope: scope.label, ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  };
  if (scopes.length) {
    await warm(scopes[0]);
    for (let offset = 1; offset < scopes.length; offset += 3) {
      await Promise.all(scopes.slice(offset, offset + 3).map(warm));
    }
  }
  return {
    ok: snapshots.every((snapshot) => snapshot.ok),
    marketplace: "wb",
    view: "rnp",
    period,
    snapshots,
    durationMs: Date.now() - startedAt,
  };
}

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  if (request.nextUrl.searchParams.get("marketplace") === "wb") {
    try {
      const rnp = await warmWbRnp();
      const scopes = await listWbRnpScopes();
      const secondary = await warmWbSecondaryDashboards(request.nextUrl.origin, scopes);
      const result = {
        ok: rnp.ok && secondary.ok,
        marketplace: "wb",
        views: { rnp, secondary },
        durationMs: rnp.durationMs + secondary.durationMs,
      };
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    } catch (error) {
      return NextResponse.json(
        { ok: false, marketplace: "wb", view: "rnp", error: error instanceof Error ? error.message : "Не удалось прогреть РНП" },
        { status: 502 },
      );
    }
  }
  const rawView = request.nextUrl.searchParams.get("view") || "overview";
  if (!VIEWS.has(rawView as OzonCockpitView)) {
    return NextResponse.json({ ok: false, error: "Неизвестный экран Ozon" }, { status: 400 });
  }

  const startedAt = Date.now();
  let scopes;
  try {
    scopes = await listOzonScopeDescriptors();
  } catch (error) {
    return NextResponse.json(
      { ok: false, view: rawView, error: error instanceof Error ? error.message : "Не удалось прочитать Ozon-кабинеты" },
      { status: 502 },
    );
  }
  if (!scopes.length) return NextResponse.json({ ok: true, view: rawView, snapshots: [], durationMs: Date.now() - startedAt });
  const snapshots: Array<{ scope: string; mode: string; ok: boolean; generatedAt?: string; error?: string }> = [];
  const warm = async (scope: (typeof scopes)[number]) => {
    try {
      const data = await loadCachedOzonCockpit({
        view: rawView as OzonCockpitView,
        scope,
        days: 14,
        taxPct: 7,
      }, { forceRefresh: true });
      snapshots.push({ scope: scope.label, mode: scope.mode, ok: true, generatedAt: data.generatedAt });
    } catch (error) {
      snapshots.push({ scope: scope.label, mode: scope.mode, ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  };

  // Сначала общий снимок прогревает нижний fetch-кэш Seller API по всем кабинетам.
  // Затем отдельные кабинеты/группы собираются небольшими параллельными пачками.
  await warm(scopes[0]);
  for (let offset = 1; offset < scopes.length; offset += 3) {
    await Promise.all(scopes.slice(offset, offset + 3).map(warm));
  }
  const ok = snapshots.every((snapshot) => snapshot.ok);
  return NextResponse.json(
    { ok, view: rawView, snapshots, durationMs: Date.now() - startedAt },
    { status: ok ? 200 : 502 },
  );
}
