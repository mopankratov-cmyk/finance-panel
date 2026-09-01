import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { discoverCabinetProducts, getWbSyncTargets, groupWbStatisticsTargets, type SyncTarget } from "@/lib/sync/cabinets";
import { allowsProduct, isScoped } from "@/lib/wb/productScope";
import { WbStocksApiError } from "@/lib/wb/stocksApi";
import { fetchWarehouseRemains, remainsToStockRows, type WbRemainsRow } from "@/lib/wb/remainsApi";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  // Отчёт warehouse_remains задачный: создание → ожидание → скачивание, плюс
  // лимит 1 задача/мин на аккаунт. Даём синку полный бюджет тяжёлой функции,
  // но оставляем 20с на апсерт, sync_log и ответ — так Vercel не обрывает
  // процесс немым 504.
  const deadline = Date.now() + 280_000;
  const allTargets = await getWbSyncTargets();
  if (!allTargets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов и WB_STATS_TOKEN не настроен" }, { status: 500 });
  }
  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const targets = onlyCabinet ? allTargets.filter((target) => target.cabinetId === onlyCabinet) : allTargets;
  if (!targets.length) {
    return NextResponse.json({ error: `Кабинет не найден: ${onlyCabinet}` }, { status: 404 });
  }

  const db = getSupabaseAdmin();
  let total = 0;
  const errors: string[] = [];

  const boundedFetch: typeof fetch = async (input, init) => {
    const remaining = deadline - Date.now();
    if (remaining <= 20_000) throw new WbStocksApiError(408, "лимит времени синхронизации остатков исчерпан");
    return fetch(input, {
      ...init,
      signal: AbortSignal.timeout(Math.min(60_000, remaining - 15_000)),
    });
  };
  const boundedSleep = async (ms: number) => {
    const remaining = deadline - Date.now();
    if (remaining <= ms + 20_000) throw new WbStocksApiError(408, "ожидание отчёта остатков перенесено на следующий запуск");
    await new Promise((resolve) => setTimeout(resolve, ms));
  };

  try {
    // Кабинеты одного продавца делят и лимит задач, и сам отчёт: warehouse_remains
    // не умеет фильтровать по nmID, поэтому качаем отчёт один раз на аккаунт и
    // раскладываем его по кабинетам группы через productScope.
    for (const group of groupWbStatisticsTargets(targets)) {
      if (Date.now() >= deadline - 20_000) {
        errors.push(`${group.map((t) => t.name).join(", ")}: синхронизация перенесена на следующий запуск из-за лимита времени`);
        break;
      }

      const ready: SyncTarget[] = [];
      for (const t of group) {
        // Отчёт остатков не возвращает бренд. Сначала обновляем каталог карточек:
        // так scoped-кабинет получает все SKU нужного бренда ещё до заказа.
        try {
          await discoverCabinetProducts(t);
        } catch (error) {
          if (isScoped(t.productScope) && !t.productScope.allowedNmIds?.length) {
            errors.push(`${t.name}: ${error instanceof Error ? error.message : "не удалось определить бренды товаров"}`);
            continue;
          }
        }
        // При недоступном Content API сохраняем fail-closed для первого запуска.
        if (isScoped(t.productScope) && !t.productScope.allowedNmIds?.length) continue;
        ready.push(t);
      }
      if (!ready.length) continue;

      let remains: WbRemainsRow[];
      try {
        remains = await fetchWarehouseRemains({
          token: ready[0].statsToken,
          fetchImpl: boundedFetch,
          sleep: boundedSleep,
        });
      } catch (error) {
        const message = error instanceof WbStocksApiError
          ? `WB ${error.status}: ${error.message}`
          : error instanceof Error ? error.message : "Unknown error";
        errors.push(`${ready.map((t) => t.name).join(", ")}: ${message}`);
        continue;
      }

      const stamp = new Date().toISOString();
      for (const t of ready) {
        const rows = remainsToStockRows(remains.filter((row) => allowsProduct(t.productScope, row.nmId)))
          .map((row) => ({ ...row, cabinet_id: t.cabinetId, synced_at: stamp }));

        const upsertError = await chunkedUpsert("wb_stocks", rows, "cabinet_id,nm_id,warehouse");
        if (upsertError) {
          errors.push(`${t.name}: ${upsertError}`);
          continue;
        }
        total += rows.length;

        // Апсёрт только дописывает. Пара (товар, склад), которая пропала из ответа
        // WB — товар кончился или уехал с этого склада, — оставалась в базе с
        // последним известным количеством НАВСЕГДА. Экран показывал остаток, а
        // оборачиваемость и план закупки считались от несуществующих штук.
        // Отчёт скачан целиком (иначе мы бы уже сделали continue), поэтому всё,
        // что не обновилось этим прогоном, честно обнуляем.
        // Пустой отчёт WB неотличим от «всё распродано», но цена ошибки разная:
        // обнулить живой остаток по всему кабинету дороже, чем оставить строку
        // лишний час. Обнуляем только когда отчёт что-то принёс.
        if (!db || rows.length === 0) continue;
        let staleQuery = db
          .from("wb_stocks")
          .update({ quantity: 0, in_way_to_client: 0, in_way_from_client: 0, synced_at: stamp })
          .lt("synced_at", stamp);
        staleQuery = t.cabinetId === null
          ? staleQuery.is("cabinet_id", null)
          : staleQuery.eq("cabinet_id", t.cabinetId);
        // У кабинета с ограниченным ассортиментом мы берём из отчёта только свои
        // товары — чужие строки этим прогоном не подтверждались и обнулять их
        // нельзя.
        if (isScoped(t.productScope)) {
          staleQuery = staleQuery.in("nm_id", [...new Set(t.productScope.allowedNmIds ?? [])]);
        }
        const { error: staleError } = await staleQuery;
        if (staleError) errors.push(`${t.name}: не удалось обнулить исчезнувшие остатки: ${staleError.message}`);
      }
    }

    const ok = errors.length === 0;
    await writeSyncLog("stocks", ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
    return NextResponse.json({ ok, rows: total, cabinets: targets.length, errors });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    const msg = (err instanceof Error ? err.message : "Unknown error") + cause;
    await writeSyncLog("stocks", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
