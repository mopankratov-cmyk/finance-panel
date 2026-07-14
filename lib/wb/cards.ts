// Карточки товаров кабинета(ов) через WB Content API: article + nm_id + name + цвет + ниша(subject).
import { getWbCabinetSources } from "@/lib/wb/cabinetTokens";
import { allowsProduct } from "@/lib/wb/productScope";
import type { ProductReadinessStatus } from "@/lib/wb/productReadiness";
import { loadHourlyDashboard, type HourlyDashboardCacheOptions } from "@/lib/cache/hourlyDashboard";

const CARDS_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";

interface Characteristic { name?: string; value?: string | string[] }
interface RawDimensions { length?: number; width?: number; height?: number; weightBrutto?: number }
interface RawPhoto { big?: string; c246x328?: string }
interface RawCard {
  nmID: number; vendorCode: string; title?: string; subjectName?: string; brand?: string;
  characteristics?: Characteristic[]; dimensions?: RawDimensions; photos?: RawPhoto[];
  // Точное поле WB под видео не подтверждено документацией (сайт блокирует прямой
  // fetch спецификации) — проверяем оба правдоподобных места best-effort. См.
  // hasVideoOn() ниже и lib/wb/media.ts за причиной, почему это важно.
  video?: unknown;
  media?: { video?: unknown };
}

function hasVideoOn(c: RawCard): boolean {
  return c.video != null || c.media?.video != null;
}

export interface CabinetCard { article: string; nm_id: number; name: string; color: string; subject: string; shop: string }

export interface PimRow {
  nmId: number; article: string; name: string; brand: string; subject: string; shop: string;
  cabinetId: string | null;
  length: number | null; width: number | null; height: number | null; weightBrutto: number | null;
  materials: string; photosCount: number; photos: string[]; hasVideo: boolean; wbUrl: string;
  readinessStatus?: ProductReadinessStatus;
  comment?: string;
  driveUrl?: string | null;
  noteUpdatedBy?: string | null;
  noteUpdatedAt?: string | null;
}

const characteristicOf = (c: RawCard, re: RegExp): string => {
  const ch = (c.characteristics || []).find((x) => re.test(x.name || ""));
  if (!ch) return "";
  return Array.isArray(ch.value) ? ch.value.join(", ") : String(ch.value || "");
};

function colorOf(c: RawCard): string {
  return characteristicOf(c, /цвет/i);
}

// cabinetId задан → один кабинет; null → все активные.
export async function fetchCabinetCards(cabinetId: string | null): Promise<CabinetCard[]> {
  const sources = await getWbCabinetSources(cabinetId, "content");
  const out: CabinetCard[] = [];
  const failures: string[] = [];
  for (const src of sources) {
    let cursor: { updatedAt?: string; nmID?: number } = {};
    try {
      for (let page = 0; page <= 30; page++) {
        const res = await fetch(CARDS_URL, {
          method: "POST",
          headers: { Authorization: src.token, "Content-Type": "application/json" },
          body: JSON.stringify({ settings: { cursor: { limit: 100, ...cursor }, filter: { withPhoto: -1 } } }),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Content API ${res.status}: ${(await res.text()).slice(0, 180)}`);
        const json = (await res.json()) as { cards?: RawCard[]; cursor?: { updatedAt?: string; nmID?: number } };
        const batch = json.cards ?? [];
        if (page === 30 && batch.length) {
          throw new Error("карточек больше безопасного лимита 3000");
        }
        for (const c of batch) {
          if (!allowsProduct(src.productScope, c.nmID, c.brand)) continue;
          out.push({ article: c.vendorCode || String(c.nmID), nm_id: c.nmID, name: c.title || "", color: colorOf(c), subject: c.subjectName || "", shop: src.name });
        }
        if (batch.length < 100) break;
        cursor = { updatedAt: json.cursor?.updatedAt, nmID: json.cursor?.nmID };
      }
    } catch (error) {
      failures.push(`${src.name}: ${error instanceof Error ? error.message : "не удалось загрузить карточки"}`);
    }
  }
  if (failures.length) throw new Error(`Карточки WB загружены не полностью: ${failures.join("; ")}`);
  return out;
}

// PIM-лайт: размеры/материалы/фото-комплектность по SKU — тот же Content API,
// без МойСклад (себестоимость и остаток уже есть отдельно в Себестоимости/Остатках).
export async function fetchCabinetPimRows(cabinetId: string | null): Promise<PimRow[]> {
  const sources = await getWbCabinetSources(cabinetId, "content");
  const results = await Promise.all(sources.map(async (src) => {
    const rows: PimRow[] = [];
    let cursor: { updatedAt?: string; nmID?: number } = {};
    try {
      for (let page = 0; page < 30; page++) {
        const res = await fetch(CARDS_URL, {
          method: "POST",
          headers: { Authorization: src.token, "Content-Type": "application/json" },
          body: JSON.stringify({ settings: { cursor: { limit: 100, ...cursor }, filter: { withPhoto: -1 } } }),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Content API ${res.status}: ${(await res.text()).slice(0, 180)}`);
        const json = (await res.json()) as { cards?: RawCard[]; cursor?: { updatedAt?: string; nmID?: number } };
        const batch = json.cards ?? [];
        for (const c of batch) {
          if (!allowsProduct(src.productScope, c.nmID, c.brand)) continue;
          const photos = (c.photos || []).map((p) => p.c246x328 || p.big || "").filter(Boolean);
          rows.push({
            nmId: c.nmID,
            article: c.vendorCode || String(c.nmID),
            name: c.title || "",
            brand: c.brand || "",
            subject: c.subjectName || "",
            shop: src.name,
            cabinetId: src.id,
            length: c.dimensions?.length ?? null,
            width: c.dimensions?.width ?? null,
            height: c.dimensions?.height ?? null,
            weightBrutto: c.dimensions?.weightBrutto ?? null,
            materials: characteristicOf(c, /материал|состав/i),
            photosCount: photos.length,
            photos,
            hasVideo: hasVideoOn(c),
            wbUrl: `https://www.wildberries.ru/catalog/${c.nmID}/detail.aspx`,
          });
        }
        if (batch.length < 100) break;
        cursor = { updatedAt: json.cursor?.updatedAt, nmID: json.cursor?.nmID };
      }
      return { ok: true as const, rows, error: null };
    } catch (error) {
      return { ok: false as const, rows: [], error: `${src.name}: ${error instanceof Error ? error.message : "не удалось загрузить карточки"}` };
    }
  }));
  const failures = results.filter((result) => !result.ok).map((result) => result.error);
  if (failures.length) throw new Error(`Карточки WB загружены не полностью: ${failures.join("; ")}`);
  return results.flatMap((result) => result.rows);
}

// Все тяжёлые GET-экраны используют один и тот же часовой снимок карточек.
// Это убирает повторный обход Content API при открытии PIM, поставок и других
// модулей, а параллельный fetch выше ограничивает холодный старт самым медленным
// кабинетом вместо суммы времени по всем кабинетам.
export function loadCabinetPimRowsHourly(
  cabinetId: string | null,
  options: HourlyDashboardCacheOptions = {},
): Promise<PimRow[]> {
  return loadHourlyDashboard(
    "wb-pim-cards",
    { cabinetId },
    () => fetchCabinetPimRows(cabinetId),
    options,
  );
}

// Свежая (не из кэша страницы) проверка конкретной карточки перед записью
// в media/save — WB документирует, что data[] ПОЛНОСТЬЮ заменяет прежний
// набор медиафайлов карточки; видео грузится отдельным методом
// (content/v3/media/file), но не подтверждено, живёт ли оно в том же
// наборе, что перетирает media/save. Пока не проверено эмпирически —
// не рискуем и блокируем запись, если видео обнаружено (см. app/api/cover-test).
export async function checkCardHasVideo(token: string, nmId: number): Promise<boolean> {
  let cursor: { updatedAt?: string; nmID?: number } = {};
  for (let page = 0; page < 30; page++) {
    const res = await fetch(CARDS_URL, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { cursor: { limit: 100, ...cursor }, filter: { withPhoto: -1 } } }),
      cache: "no-store",
    });
    if (!res.ok) return true; // не смогли проверить — считаем небезопасным по умолчанию
    const json = (await res.json()) as { cards?: RawCard[]; cursor?: { updatedAt?: string; nmID?: number } };
    const batch = json.cards ?? [];
    const found = batch.find((c) => c.nmID === nmId);
    if (found) return hasVideoOn(found);
    if (batch.length < 100) return true; // карточку не нашли — тоже не рискуем
    cursor = { updatedAt: json.cursor?.updatedAt, nmID: json.cursor?.nmID };
  }
  return true;
}
