// Разбор снимка от внешнего сборщика (tools/shelf-collector). Контракт повторяет
// вывод scrape.js автора наработок: {article, collectedAt, our, competitors[]}.
// Валидация строгая: молчаливое приведение мусора к нулям исказило бы средние.

import type { ShelfRow } from "@/lib/shelf/slices";

export const SHELF_MAX_COMPETITORS = 40;

export interface ShelfSnapshotPayload {
  nmId: number;
  collectedAt: string;
  our: {
    brand: string | null;
    price: number | null;
    img: string | null;
    link: string | null;
  };
  competitors: ShelfRow[];
}

export type ShelfIngestParseResult =
  | { ok: true; snapshot: ShelfSnapshotPayload }
  | { ok: false; error: string };

// Только число или непустая числовая строка: Number(true)=1 и Number('')=0 —
// молчаливые превращения мусора в «данные», их отсекаем явно.
function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function asPositiveInt(value: unknown): number | null {
  const num = asFiniteNumber(value);
  return num != null && Number.isInteger(num) && num > 0 ? num : null;
}

function asPriceOrNull(value: unknown, label: string): { ok: true; price: number | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, price: null };
  const num = asFiniteNumber(value);
  if (num == null || num < 0) return { ok: false, error: `${label}: цена должна быть числом ≥ 0 или null` };
  return { ok: true, price: num };
}

function asTextOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 2000) : null;
}

// Ссылки и фото приходят из DOM чужой страницы и уходят в src/href нашего UI —
// пропускаем только https, всё прочее (javascript:, data:, относительное) в null.
function asHttpsUrlOrNull(value: unknown): string | null {
  const text = asTextOrNull(value);
  return text && /^https:\/\//i.test(text) ? text : null;
}

export function parseShelfSnapshotPayload(body: unknown): ShelfIngestParseResult {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Пустое тело запроса" };
  const payload = body as Record<string, unknown>;

  const nmId = asPositiveInt(payload.article);
  if (!nmId) return { ok: false, error: "article: нужен положительный целый артикул WB" };

  const collectedAtRaw = payload.collectedAt == null ? null : String(payload.collectedAt);
  const collectedAtMs = collectedAtRaw ? Date.parse(collectedAtRaw) : NaN;
  if (!Number.isFinite(collectedAtMs)) {
    return { ok: false, error: "collectedAt: нужна валидная дата-время сбора (ISO)" };
  }

  const our = (typeof payload.our === "object" && payload.our !== null ? payload.our : {}) as Record<string, unknown>;
  const ourPrice = asPriceOrNull(our.price, "our.price");
  if (!ourPrice.ok) return ourPrice;

  const competitorsRaw = payload.competitors;
  if (!Array.isArray(competitorsRaw)) return { ok: false, error: "competitors: нужен массив" };
  if (competitorsRaw.length > SHELF_MAX_COMPETITORS) {
    return { ok: false, error: `competitors: больше ${SHELF_MAX_COMPETITORS} строк — похоже на сбой сборщика` };
  }

  const competitors: ShelfRow[] = [];
  const seenPositions = new Set<number>();
  for (const [index, raw] of competitorsRaw.entries()) {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: `competitors[${index}]: не объект` };
    const row = raw as Record<string, unknown>;
    const position = asPositiveInt(row.position);
    if (!position) return { ok: false, error: `competitors[${index}]: position должен быть положительным целым` };
    if (seenPositions.has(position)) return { ok: false, error: `competitors[${index}]: позиция ${position} повторяется` };
    seenPositions.add(position);
    const price = asPriceOrNull(row.price, `competitors[${index}].price`);
    if (!price.ok) return price;
    competitors.push({
      position,
      nmId: asPositiveInt(row.article),
      brand: asTextOrNull(row.brand),
      price: price.price,
      img: asHttpsUrlOrNull(row.img),
    });
  }

  return {
    ok: true,
    snapshot: {
      nmId,
      collectedAt: new Date(collectedAtMs).toISOString(),
      our: {
        brand: asTextOrNull(our.brand),
        price: ourPrice.price,
        img: asHttpsUrlOrNull(our.img),
        link: asHttpsUrlOrNull(our.link),
      },
      competitors,
    },
  };
}
