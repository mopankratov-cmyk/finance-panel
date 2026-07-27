import { NextRequest, NextResponse } from "next/server";
import { listOzonScopeDescriptors } from "@/lib/ozon/cabinet";
import type { OzonCockpitView } from "@/lib/ozon/cockpit";
import { loadCachedOzonCockpit } from "@/lib/ozon/cockpitCache";
import {
  currentMoscowMonth,
  listWbRnpScopes,
  loadCachedWbRnp,
} from "@/lib/rnp/tableCache";
import { checkCronAuth } from "@/lib/sync/helpers";
import { warmWbSecondaryDashboards } from "@/lib/wb/dashboardWarmup";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import {
  WB_CACHE_PROGRESS_JOBS,
  WB_CACHE_REQUIRED_JOBS,
  wbCacheProgressReadiness,
  wbCacheReadiness,
} from "@/lib/sync/wbCacheReadiness";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VIEWS = new Set<OzonCockpitView>(["overview", "sales", "adverts", "stocks", "orders", "economy", "health"]);
const BLOCKING_SNAPSHOT_REFRESH = { forceRefresh: true } as const;

function shiftIsoDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function currentMoscowWeek(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const to = `${part("year")}-${part("month")}-${part("day")}`;
  return { from: shiftIsoDate(to, -6), to };
}

async function warmWbRnp() {
  const startedAt = Date.now();
  const scopes = await listWbRnpScopes();
  // Интерфейс открывает последние 7 дней, а раньше cron грел только календарный
  // месяц. Из-за несовпадающего ключа кэша первый пользователь запускал тяжёлый
  // расчёт сам. Греем оба реально используемых периода.
  const periods = [...new Map(
    [currentMoscowWeek(), currentMoscowMonth()].map((period) => [`${period.from}:${period.to}`, period]),
  ).values()];
  const snapshots: Array<{ scope: string; from: string; to: string; ok: boolean; generatedAt?: string; error?: string }> = [];
  const warm = async (scope: (typeof scopes)[number], period: (typeof periods)[number]) => {
    try {
      await loadCachedWbRnp({ ...period, ...scope }, BLOCKING_SNAPSHOT_REFRESH);
      snapshots.push({ scope: scope.label, ...period, ok: true, generatedAt: new Date().toISOString(), error: undefined });
    } catch (error) {
      snapshots.push({ scope: scope.label, ...period, ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  };
  if (scopes.length) {
    for (const period of periods) await warm(scopes[0], period);
    for (let offset = 1; offset < scopes.length; offset += 3) {
      await Promise.all(scopes.slice(offset, offset + 3).map(async (scope) => {
        for (const period of periods) await warm(scope, period);
      }));
    }
  }
  return {
    ok: snapshots.every((snapshot) => snapshot.ok),
    marketplace: "wb",
    view: "rnp",
    periods,
    snapshots,
    durationMs: Date.now() - startedAt,
  };
}

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  if (request.nextUrl.searchParams.get("marketplace") === "wb") {
    try {
      const db = getSupabaseAdmin();
      if (!db) return NextResponse.json({ ok: false, marketplace: "wb", error: "Supabase не настроен" }, { status: 500 });
      const syncLog = await db
        .from("sync_log")
        .select("job, status, finished_at, error")
        .in("job", [...WB_CACHE_REQUIRED_JOBS])
        .order("finished_at", { ascending: false })
        .limit(200);
      if (syncLog.error) return NextResponse.json({ ok: false, marketplace: "wb", error: syncLog.error.message }, { status: 502 });
      const readiness = wbCacheReadiness(syncLog.data ?? []);
      const cabinets = await getActiveWbCabinets();
      const progressJobs = [...WB_CACHE_PROGRESS_JOBS, "product-scope"];
      const progressRows = cabinets.length
        ? await db.from("wb_sync_state")
          .select("cabinet_id, job, status, last_error")
          .in("cabinet_id", cabinets.map((cabinet) => cabinet.id))
          .in("job", progressJobs)
        : { data: [], error: null };
      if (progressRows.error) {
        return NextResponse.json({ ok: false, marketplace: "wb", error: progressRows.error.message }, { status: 502 });
      }
      const progressReadiness = wbCacheProgressReadiness(
        progressRows.data ?? [],
        cabinets.map((cabinet) => ({ id: cabinet.id, scoped: cabinet.brand_filters.length > 0 })),
      );
      // Прогреваем из последнего сохранённого набора фактов даже пока один из
      // длинных курсоров догоняет историю. Иначе отзывы/реклама блокировали PIM
      // и «Склейки», хотя их каталог уже был полностью доступен.
      const rnp = await warmWbRnp();
      const scopes = await listWbRnpScopes();
      const secondary = await warmWbSecondaryDashboards(request.nextUrl.origin, scopes);
      const result = {
        ok: rnp.ok && secondary.ok,
        marketplace: "wb",
        views: { rnp, secondary },
        readiness: { ready: readiness.ready && progressReadiness.ready, jobs: readiness, progress: progressReadiness },
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
      }, BLOCKING_SNAPSHOT_REFRESH);
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
