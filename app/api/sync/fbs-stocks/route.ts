import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { warmFbsBarcodeCatalog } from "@/lib/wb/fbsBarcodeCatalog";
import { fetchFbsStocks, fetchFbsWarehouses } from "@/lib/wb/fbsMarketplace";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Остатки складов продавца (FBS) в базу.
//
// Экран воронки показывает три колонки — FBO, FBS и общий, — и ему нужен
// мгновенный ответ. Живой обход на это не годится: WB отдаёт остатки только
// по списку баркодов, запросом на каждую тысячу баркодов на каждый склад, а
// справочник баркодов сам собирается обходом Content API.
//
// Поэтому обход живёт здесь, в фоне, а экраны читают готовые числа.
export const maxDuration = 300;

/** Один кабинет за прогон: обход тяжёлый, а лимит у WB общий на продавца. */
const SLOT_MS = 60 * 60_000;

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const deadline = Date.now() + 260_000;

  const all = (await getWbSyncTargets())
    .filter((target) => target.cabinetId)
    .sort((a, b) => String(a.cabinetId).localeCompare(String(b.cabinetId)));
  if (!all.length) {
    await writeSyncLog("fbs-stocks", "ok", 0, "Нет кабинетов с доступом к Marketplace", startedAt);
    return NextResponse.json({ ok: true, summary: [] });
  }

  // Кабинеты обходим по кругу: за сутки каждый успевает обновиться.
  const target = all[Math.floor(Date.now() / SLOT_MS) % all.length];
  const cabinetId = target.cabinetId!;

  try {
    const warehouses = await fetchFbsWarehouses(target.advertToken);
    if (!warehouses.length) {
      // Складов продавца нет — это не ошибка, а факт: кабинет торгует только FBO.
      await writeSyncLog("fbs-stocks", "ok", 0, `${target.name}: складов продавца нет — остатки FBS вести негде`, startedAt);
      return NextResponse.json({ ok: true, summary: [{ cabinet: target.name, warehouses: 0, rows: 0 }] });
    }

    const catalog = await warmFbsBarcodeCatalog(cabinetId);
    const barcodes = catalog.entries.map((entry) => entry.barcode).filter(Boolean);
    if (!barcodes.length) {
      await writeSyncLog("fbs-stocks", "error", 0, `${target.name}: справочник баркодов пуст — обход карточек не дал ни одного баркода`, startedAt);
      return NextResponse.json({ ok: false, error: "Справочник баркодов пуст" }, { status: 502 });
    }
    const nmByBarcode = new Map(catalog.entries.map((entry) => [entry.barcode, entry.nmId]));

    // Складов у продавца может быть несколько, и товар лежит на каждом свой:
    // складываем, а не берём первый попавшийся.
    const totals = new Map<number, number>();
    let visited = 0;
    // Обход одного склада идёт чанками по баркодам и на исчерпании бюджета
    // ВОЗВРАЩАЕТ `complete: false`, а не бросает. Если этот флаг потерять,
    // склад засчитывается опрошенным целиком, и товары из непрочитанных чанков
    // выглядят исчезнувшими — с обнулением ниже это стирает живой остаток.
    let walkComplete = true;
    for (const warehouse of warehouses) {
      if (Date.now() > deadline) { walkComplete = false; break; }
      const { amounts, complete } = await fetchFbsStocks(target.advertToken, warehouse.id, barcodes, { deadlineMs: deadline });
      if (!complete) walkComplete = false;
      for (const [barcode, amount] of amounts) {
        const nmId = nmByBarcode.get(barcode);
        if (!nmId || !Number.isFinite(amount)) continue;
        totals.set(nmId, (totals.get(nmId) ?? 0) + amount);
      }
      visited += 1;
    }

    const stamp = new Date().toISOString();
    const rows = [...totals].map(([nm_id, quantity]) => ({
      cabinet_id: cabinetId,
      nm_id,
      quantity,
      warehouses: visited,
      synced_at: stamp,
    }));
    const upsertError = rows.length ? await chunkedUpsert("wb_fbs_stocks", rows, "cabinet_id,nm_id") : null;
    if (upsertError) throw new Error(upsertError);

    const partial = visited < warehouses.length || !walkComplete;
    // Апсёрт не умеет забывать. Товар, который распродали на всех складах
    // продавца, пропадает из ответа — и его последний остаток жил в базе
    // вечно. Обнуляем только после ПОЛНОГО обхода: после частичного «пропажа»
    // означала бы всего лишь неопрошенный склад.
    // Та же осторожность, что и в FBO: пустой результат обхода чаще означает
    // сбой на стороне WB, чем «на всех складах ноль».
    if (!partial && catalog.complete && rows.length > 0) {
      const db = getSupabaseAdmin();
      if (db) {
        const { error: staleError } = await db
          .from("wb_fbs_stocks")
          .update({ quantity: 0, warehouses: visited, synced_at: stamp })
          .eq("cabinet_id", cabinetId)
          .lt("synced_at", stamp);
        if (staleError) throw new Error(`не удалось обнулить исчезнувшие остатки FBS: ${staleError.message}`);
      }
    }
    const note = `${target.name}: складов ${visited} из ${warehouses.length}, товаров с остатком ${rows.filter((row) => row.quantity > 0).length}`
      + (partial ? (visited < warehouses.length ? " · обход не закончен, часть складов не опрошена" : " · обход склада оборван по бюджету, часть баркодов не спрошена") : "")
      + (catalog.complete ? "" : " · справочник баркодов неполный");
    await writeSyncLog("fbs-stocks", partial ? "error" : "ok", rows.length, note, startedAt);
    return NextResponse.json({ ok: !partial, summary: [{ cabinet: target.name, warehouses: visited, rows: rows.length }] });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "Не удалось собрать остатки FBS";
    await writeSyncLog("fbs-stocks", "error", 0, `${target.name}: ${message}`, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
