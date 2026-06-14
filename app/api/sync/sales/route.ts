import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets, lastSyncDate } from "@/lib/sync/cabinets";

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const targets = await getWbSyncTargets();
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов и WB_STATS_TOKEN не настроен" }, { status: 500 });
  }

  // ?from=YYYY-MM-DD — принудительный ре-синк с даты (бэкфилл price_with_disc), общий для всех кабинетов
  const forceFrom = new URL(request.url).searchParams.get("from");

  let total = 0;
  const errors: string[] = [];

  try {
    for (const t of targets) {
      const last = forceFrom ? null : await lastSyncDate("wb_sales", t.cabinetId);
      const dateFrom = forceFrom
        ? new Date(forceFrom).toISOString().slice(0, 19)
        : last
          ? new Date(last).toISOString().slice(0, 19)
          : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);

      const url = new URL("https://statistics-api.wildberries.ru/api/v1/supplier/sales");
      url.searchParams.set("dateFrom", dateFrom);
      url.searchParams.set("flag", "0");

      const res = await fetch(url.toString(), { headers: { Authorization: t.statsToken }, cache: "no-store" });
      if (!res.ok) {
        errors.push(`${t.name}: WB ${res.status}: ${(await res.text()).slice(0, 120)}`);
        continue;
      }

      const sales: Record<string, unknown>[] = await res.json();
      if (!sales.length) continue;

      const rows = sales
        .map((s) => ({
          sale_id: s.saleID as string,
          nm_id: s.nmId as number,
          date: s.date as string,
          for_pay: s.forPay as number | null,
          finished_price: s.finishedPrice as number | null,
          // цена до СПП: priceWithDisc, иначе totalPrice×(1−disc%)
          price_with_disc: (s.priceWithDisc as number | null) ?? (s.totalPrice != null ? Number(s.totalPrice) * (1 - Number(s.discountPercent ?? 0) / 100) : null),
          cabinet_id: t.cabinetId,
          synced_at: new Date().toISOString(),
        }))
        .filter((r) => r.sale_id);

      const upsertError = await chunkedUpsert("wb_sales", rows, "sale_id");
      if (upsertError) {
        errors.push(`${t.name}: ${upsertError}`);
        continue;
      }
      total += rows.length;
    }

    const ok = errors.length === 0;
    await writeSyncLog("sales", ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
    return NextResponse.json({ ok, rows: total, cabinets: targets.length, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("sales", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
