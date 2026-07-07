// Карточки товаров кабинета(ов) через WB Content API: article + nm_id + name + цвет + ниша(subject).
import { getWbCabinetSources } from "@/lib/wb/cabinetTokens";

const CARDS_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";

interface Characteristic { name?: string; value?: string | string[] }
interface RawDimensions { length?: number; width?: number; height?: number; weightBrutto?: number }
interface RawPhoto { big?: string; c246x328?: string }
interface RawCard {
  nmID: number; vendorCode: string; title?: string; subjectName?: string; brand?: string;
  characteristics?: Characteristic[]; dimensions?: RawDimensions; photos?: RawPhoto[];
}

export interface CabinetCard { article: string; nm_id: number; name: string; color: string; subject: string; shop: string }

export interface PimRow {
  nmId: number; article: string; name: string; brand: string; subject: string; shop: string;
  cabinetId: string | null;
  length: number | null; width: number | null; height: number | null; weightBrutto: number | null;
  materials: string; photosCount: number; photos: string[]; wbUrl: string;
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
  for (const src of sources) {
    let cursor: { updatedAt?: string; nmID?: number } = {};
    try {
      for (let page = 0; page < 30; page++) {
        const res = await fetch(CARDS_URL, {
          method: "POST",
          headers: { Authorization: src.token, "Content-Type": "application/json" },
          body: JSON.stringify({ settings: { cursor: { limit: 100, ...cursor }, filter: { withPhoto: -1 } } }),
          cache: "no-store",
        });
        if (!res.ok) break;
        const json = (await res.json()) as { cards?: RawCard[]; cursor?: { updatedAt?: string; nmID?: number } };
        const batch = json.cards ?? [];
        for (const c of batch) out.push({ article: c.vendorCode || String(c.nmID), nm_id: c.nmID, name: c.title || "", color: colorOf(c), subject: c.subjectName || "", shop: src.name });
        if (batch.length < 100) break;
        cursor = { updatedAt: json.cursor?.updatedAt, nmID: json.cursor?.nmID };
      }
    } catch { /* пропускаем кабинет при ошибке */ }
  }
  return out;
}

// PIM-лайт: размеры/материалы/фото-комплектность по SKU — тот же Content API,
// без МойСклад (себестоимость и остаток уже есть отдельно в Себестоимости/Остатках).
export async function fetchCabinetPimRows(cabinetId: string | null): Promise<PimRow[]> {
  const sources = await getWbCabinetSources(cabinetId, "content");
  const out: PimRow[] = [];
  for (const src of sources) {
    let cursor: { updatedAt?: string; nmID?: number } = {};
    try {
      for (let page = 0; page < 30; page++) {
        const res = await fetch(CARDS_URL, {
          method: "POST",
          headers: { Authorization: src.token, "Content-Type": "application/json" },
          body: JSON.stringify({ settings: { cursor: { limit: 100, ...cursor }, filter: { withPhoto: -1 } } }),
          cache: "no-store",
        });
        if (!res.ok) break;
        const json = (await res.json()) as { cards?: RawCard[]; cursor?: { updatedAt?: string; nmID?: number } };
        const batch = json.cards ?? [];
        for (const c of batch) {
          const photos = (c.photos || []).map((p) => p.c246x328 || p.big || "").filter(Boolean);
          out.push({
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
            wbUrl: `https://www.wildberries.ru/catalog/${c.nmID}/detail.aspx`,
          });
        }
        if (batch.length < 100) break;
        cursor = { updatedAt: json.cursor?.updatedAt, nmID: json.cursor?.nmID };
      }
    } catch { /* пропускаем кабинет при ошибке */ }
  }
  return out;
}
