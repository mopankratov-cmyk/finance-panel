import { createHash } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { after } from "next/server";
import { decodeCompressedJson, encodeCompressedJson } from "@/lib/cache/compressedJson";

// Справочник товаров для экрана «Реклама» (заказы/выручка за месяц, остатки,
// себестоимость) считается RPC-агрегатом по месяцу заказов — на крупном
// кабинете это 10–14 секунд, и именно он держал весь экран. Данные под ним
// обновляются часовыми синками, поэтому честно отдавать last-good снимок
// мгновенно и освежать его в фоне (stale-while-revalidate по образцу РНП,
// PR#444). Живые ставки и статусы кампаний в этот кэш НЕ входят — они
// по-прежнему читаются на каждый запрос.
export const WB_ADVERT_REPORT_CACHE_SECONDS = 6 * 60 * 60;
// Старше этого возраста снимок помечается на фоновую пересборку.
export const WB_ADVERT_REPORT_STALE_MS = 30 * 60 * 1000;
export const WB_ADVERT_REPORT_CACHE_VERSION = "v1";

interface AdvertReportSnapshot<Row> {
  rows: Row[];
  generated_at: string;
}

// Ключ учитывает продуктовый контур запроса: у ограниченного пользователя
// scoped-загрузчик строит другие строки, и общий ключ отдал бы ему чужие.
export function advertReportScopeKey(allowedNmIds: ReadonlySet<number> | null): string {
  if (!allowedNmIds) return "full";
  const sorted = [...allowedNmIds].sort((a, b) => a - b).join(",");
  return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}

export function advertReportCacheTag(cabinetId: string | null, scopeKey: string): string {
  const identity = JSON.stringify({ cabinet: cabinetId ?? "all", scope: scopeKey });
  return `wb-adverts-report:${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

export async function loadCachedAdvertReportRows<Row>(
  cabinetId: string | null,
  scopeKey: string,
  loader: () => Promise<Row[]>,
): Promise<Row[]> {
  const identity = JSON.stringify({ cabinet: cabinetId ?? "all", scope: scopeKey });
  const tag = advertReportCacheTag(cabinetId, scopeKey);
  const loadSnapshot = unstable_cache(
    async () => {
      const snapshot: AdvertReportSnapshot<Row> = {
        rows: await loader(),
        generated_at: new Date().toISOString(),
      };
      return encodeCompressedJson(snapshot);
    },
    [`wb-adverts-report-${WB_ADVERT_REPORT_CACHE_VERSION}`, identity],
    { revalidate: WB_ADVERT_REPORT_CACHE_SECONDS, tags: [tag] },
  );
  const snapshot = decodeCompressedJson<AdvertReportSnapshot<Row>>(await loadSnapshot());
  const ageMs = Date.now() - Date.parse(snapshot.generated_at || "");
  if (!Number.isFinite(ageMs) || ageMs > WB_ADVERT_REPORT_STALE_MS) {
    // Синхронный сброс ключа на чтении устроил бы блокирующую пересборку
    // (грабли вечной петли РНП). Помечаем тег после ответа: следующий запрос
    // получит прежний снимок сразу, а пересборка уйдёт в фон.
    after(() => {
      revalidateTag(tag, "max");
    });
  }
  return snapshot.rows;
}
