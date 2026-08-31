import { NextRequest, NextResponse } from "next/server";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { resolveOzonPeriod } from "@/lib/ozon/period";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cachedOzonImages } from "@/lib/ozon/staticCache";
import { ozonAdHistoryDays } from "@/lib/ozon/adCoverage";
import { isOzonAdCabinetTotalSku, isOzonAdServiceSku } from "@/lib/ozon/adDailyMarkers";
import { readOzonAdDaily } from "@/lib/ozon/adDailyRead";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Журнал рекламы по дням.
 *
 * Посуточные строки копятся в `ozon_ad_daily` давно, но ни один экран их не
 * показывал: расход всюду схлопывался в одно число за период. Из-за этого
 * менеджер не видел, в какой день расход подскочил и когда именно кампанию
 * стоило трогать.
 *
 * Читает только базу (плюс кэшированный справочник карточек ради названий),
 * поэтому отвечает быстро и не тратит лимит Ozon.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const period = resolveOzonPeriod(params.get("from"), params.get("to"), Number(params.get("days")) || 14);
  const resolved = await getOzonCabinetScope(params.get("cabinet"));
  if (!resolved.ok) return NextResponse.json({ error: resolved.error, noCabinet: true }, { status: 404 });
  const scope = resolved.scope;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "База недоступна" }, { status: 503 });

  const clientIds = scope.cabinets.map((cabinet) => cabinet.clientId);
  let data: Awaited<ReturnType<typeof readOzonAdDaily>>["rows"];
  try {
    ({ rows: data } = await readOzonAdDaily(db, clientIds, period.from, period.to, "client_id, sku, date, spent, orders_money"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "История не прочитана" }, { status: 502 });
  }

  // Справочник карточек берём по кабинету и только ради названий и картинок:
  // сам журнал целиком собирается из базы.
  const identity = new Map<string, { skuToOffer: Record<string, string>; bySku: Record<string, string> }>();
  await Promise.all(scope.cabinets.map(async (cabinet) => {
    const images = await cachedOzonImages(cabinet.creds);
    identity.set(cabinet.clientId, { skuToOffer: images.skuToOffer ?? {}, bySku: images.bySku ?? {} });
  }));

  const days: string[] = [];
  for (
    let cursor = Date.parse(`${period.from}T00:00:00Z`);
    cursor <= Date.parse(`${period.to}T00:00:00Z`);
    cursor += 86_400_000
  ) days.push(new Date(cursor).toISOString().slice(0, 10));

  interface JournalRow {
    key: string;
    clientId: string;
    cabinet: string;
    sku: string;
    offerId: string;
    name: string;
    image: string | null;
    total: number;
    adRevenue: number;
    byDay: Record<string, number>;
  }
  const rows = new Map<string, JournalRow>();
  const totalsByDay: Record<string, number> = Object.fromEntries(days.map((day) => [day, 0]));
  // Итоги держим отдельно по кабинетам: складывать их можно только после
  // того, как для каждого выбран свой источник.
  const cabinetTotals = new Map<string, Record<string, number>>();
  const skuTotals = new Map<string, Record<string, number>>();
  const collectedDays = new Map<string, Set<string>>();
  const cabinetName = new Map(scope.cabinets.map((cabinet) => [cabinet.clientId, cabinet.name]));

  // Итог по кабинету за день Ozon отдаёт сразу; разнесение по товарам едет
  // отчётами. Раньше журнал показывал пустоту, пока не доедет разнесение, —
  // хотя сумма расхода по дням была известна с самого начала.
  const cabinetDays = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const clientId = String(row.client_id);
    const day = String(row.date).slice(0, 10);
    if (isOzonAdCabinetTotalSku(row.sku)) {
      const known = cabinetDays.get(clientId) ?? new Set<string>();
      known.add(day);
      cabinetDays.set(clientId, known);
      const perCabinet = cabinetTotals.get(clientId) ?? {};
      perCabinet[day] = (perCabinet[day] ?? 0) + Number(row.spent ?? 0);
      cabinetTotals.set(clientId, perCabinet);
      continue;
    }
    const dates = collectedDays.get(clientId) ?? new Set<string>();
    dates.add(day);
    collectedDays.set(clientId, dates);
    // Маркер «день собран, расхода не было» — в таблицу строк не попадает,
    // но покрытие подтверждает.
    if (isOzonAdServiceSku(row.sku)) continue;

    const sku = String(row.sku);
    const key = `${clientId}:${sku}`;
    const meta = identity.get(clientId);
    const entry = rows.get(key) ?? {
      key,
      clientId,
      cabinet: cabinetName.get(clientId) ?? clientId,
      sku,
      offerId: meta?.skuToOffer[sku] ?? "",
      name: meta?.skuToOffer[sku] || sku,
      image: meta?.bySku[sku] ?? null,
      total: 0,
      adRevenue: 0,
      byDay: {},
    };
    const spent = Number(row.spent ?? 0);
    entry.byDay[day] = (entry.byDay[day] ?? 0) + spent;
    entry.total += spent;
    entry.adRevenue += Number(row.orders_money ?? 0);
    rows.set(key, entry);
    const perCabinetSku = skuTotals.get(clientId) ?? {};
    perCabinetSku[day] = (perCabinetSku[day] ?? 0) + spent;
    skuTotals.set(clientId, perCabinetSku);
  }

  // Итог дня собирается ПО КАЖДОМУ кабинету и только потом складывается.
  // Общая куча теряла расход: если у одного кабинета есть суточный итог, а у
  // другого только разнесение по товарам, вклад второго пропадал целиком.
  for (const day of days) {
    let total = 0;
    for (const clientId of clientIds) {
      const known = cabinetTotals.get(clientId)?.[day];
      total += known != null ? known : (skuTotals.get(clientId)?.[day] ?? 0);
    }
    totalsByDay[day] = total;
  }

  const historyDays = ozonAdHistoryDays(period.days, period.endsToday);
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    scope: { label: scope.label, count: scope.cabinets.length },
    period: { from: period.from, to: period.to, days: period.days },
    days,
    totalsByDay,
    total: Math.round(Object.values(totalsByDay).reduce((sum, value) => sum + value, 0)),
    rows: [...rows.values()]
      .map((row) => ({ ...row, total: Math.round(row.total), adRevenue: Math.round(row.adRevenue) }))
      .sort((left, right) => right.total - left.total),
    coverage: scope.cabinets.map((cabinet) => ({
      cabinet: cabinet.name,
      periodDays: period.days,
      historyDays,
      coveredDays: collectedDays.get(cabinet.clientId)?.size ?? 0,
      source: "daily" as const,
      complete: (collectedDays.get(cabinet.clientId)?.size ?? 0) >= historyDays && historyDays > 0,
      cabinetDays: cabinetDays.get(cabinet.clientId)?.size ?? 0,
    })),
  });
}
