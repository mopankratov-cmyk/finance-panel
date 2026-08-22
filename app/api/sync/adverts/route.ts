import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { allowsNm, isScoped } from "@/lib/wb/productScope";

// Информация о кампаниях: отдаёт все кампании продавца разом
const ADVERTS_URL = "https://advert-api.wildberries.ru/api/advert/v2/adverts";

interface NmSetting {
  nm_id?: number;
  bids_kopecks?: { recommendations?: number; search?: number };
}

interface AdvertInfo {
  id?: number;
  status?: number;
  bid_type?: string;
  nm_settings?: NmSetting[];
  settings?: { name?: string };
}

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const allTargets = await getWbSyncTargets();
  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const targets = onlyCabinet ? allTargets.filter((target) => target.cabinetId === onlyCabinet) : allTargets;
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов и WB_TOKEN_ADVERT не настроен" }, { status: 500 });
  }

  let total = 0;
  const errors: string[] = [];

  try {
    for (const t of targets) {
      const res = await fetch(ADVERTS_URL, { headers: { Authorization: t.advertToken }, cache: "no-store" });
      if (!res.ok) {
        errors.push(`${t.name}: WB ${res.status}: ${(await res.text()).slice(0, 120)}`);
        continue;
      }

      const json = (await res.json()) as { adverts?: AdvertInfo[] };
      const adverts = json.adverts ?? [];

      const rows = adverts
        .filter((a) => a.id)
        .map((a) => {
          const allNmIds = [
            ...new Set(
              (a.nm_settings ?? [])
                .map((n) => n.nm_id)
                .filter((n): n is number => typeof n === "number"),
            ),
          ];
          const nmIds = allNmIds.filter((nm) => allowsNm(t.productScope, nm));
          // Этот метод отдаёт ставку, а не дневной бюджет. Ставок две — в поиске
          // и на полках; журнал РК раскладывает кампании по видам размещения
          // именно по тому, какая из них живая, поэтому берём обе. Первая
          // карточка не показательна: у неё ставка бывает нулевой, когда у
          // остальных она задана, — ищем первое ненулевое значение.
          const firstBid = (pick: (s: NmSetting) => number | undefined) => {
            for (const setting of a.nm_settings ?? []) {
              const value = pick(setting);
              if (value != null && value > 0) return value / 100;
            }
            return null;
          };
          const bidSearch = firstBid((s) => s.bids_kopecks?.search);
          const bidShelf = firstBid((s) => s.bids_kopecks?.recommendations);
          return {
            advert_id: a.id as number,
            name: a.settings?.name ?? null,
            type: null as number | null,
            // Сырой тип ставки WB — без него рекламу не разложить по видам кампаний.
            bid_type: (a.bid_type as string | null) ?? null,
            status: a.status ?? null,
            bid_cpm_rub: bidSearch ?? bidShelf,
            bid_search_rub: bidSearch,
            bid_shelf_rub: bidShelf,
            // Сырая карточка: поля WB под виды размещения меняются, и без
            // исходника разметку пришлось бы угадывать по именам кампаний.
            raw: a as unknown as Record<string, unknown>,
            nm_ids: nmIds.length ? nmIds : null,
            cabinet_id: t.cabinetId,
            synced_at: new Date().toISOString(),
          };
        })
        .filter((row) => !isScoped(t.productScope) || (row.nm_ids?.length ?? 0) > 0);

      if (!rows.length) continue;

      let upsertError = await chunkedUpsert("wb_adverts", rows, "cabinet_id,advert_id");
      let fallbackRows: Record<string, unknown>[] = rows;
      if (upsertError && /bid_search_rub|bid_shelf_rub|raw|schema cache|column/i.test(upsertError)) {
        // Окно совместимости, пока миграция журнала РК не применена.
        fallbackRows = rows.map(({ bid_search_rub, bid_shelf_rub, raw, ...row }) => ({ ...row }));
        upsertError = await chunkedUpsert("wb_adverts", fallbackRows, "cabinet_id,advert_id");
      }
      if (upsertError && /bid_type|schema cache|column/i.test(upsertError)) {
        // Миграция bid_type могла ещё не примениться — пишем без неё.
        // От fallbackRows, а не от rows: иначе шаг вернул бы обратно колонки,
        // отброшенные предыдущим фолбэком.
        fallbackRows = fallbackRows.map(({ bid_type, ...row }) => ({ ...row }));
        upsertError = await chunkedUpsert("wb_adverts", fallbackRows, "cabinet_id,advert_id");
      }
      if (upsertError && /bid_cpm_rub|schema cache|column/i.test(upsertError)) {
        // Короткое окно совместимости, пока SQL-миграция ещё не применена.
        upsertError = await chunkedUpsert("wb_adverts", fallbackRows.map((row) => {
          const { bid_cpm_rub, ...rest } = row as { bid_cpm_rub: number | null } & Record<string, unknown>;
          return { ...rest, daily_budget: bid_cpm_rub };
        }), "cabinet_id,advert_id");
      }
      if (upsertError) {
        errors.push(`${t.name}: ${upsertError}`);
        continue;
      }
      total += rows.length;
    }

    const ok = errors.length === 0;
    await writeSyncLog("adverts", ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
    return NextResponse.json({ ok, rows: total, cabinets: targets.length, errors });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    const msg = (err instanceof Error ? err.message : "Unknown error") + cause;
    await writeSyncLog("adverts", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
