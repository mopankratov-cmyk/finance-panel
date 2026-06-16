// Тонкий клиент MPStats (рыночная аналитика WB) — ниши, частотность запросов, позиции.
// Токен в env MPSTATS_TOKEN (значение — из скилла ~/.agents/skills/mpstats/config/.env).
// Данные оценочные (MPStats занижает ~×2.3 по продажам) — для НАПРАВЛЕНИЯ/тренда, не абсолюта.
// Кэшируем через Next fetch revalidate, чтобы не жечь квоту (10k WB-вызовов).

const BASE = "https://mpstats.io/api/analytics/v1/wb";
const TOKEN = process.env.MPSTATS_TOKEN;
const TTL = 6 * 3600; // 6ч кэш — рынок меняется медленно

export function hasMpstats(): boolean {
  return !!TOKEN;
}

async function post<T>(path: string, query: string, body: unknown, revalidate = TTL): Promise<T | null> {
  if (!TOKEN) return null;
  const url = `${BASE}${path}${query ? `?${query}` : ""}`;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "X-Mpstats-TOKEN": TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        next: { revalidate },
      });
      if (res.status === 429) { await sleep(1500); continue; }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      await sleep(1200);
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = (s: string) => encodeURIComponent(s);

export interface SubjectDay { period?: string; sales?: number; revenue?: number }
export interface NicheQuery { word: string; wb_count: number; items_count?: number }
export interface SkuKwRow { query: string; wb_count?: number; avg_organic_position?: number | null; avg_ad_position?: number | null }

// Ниша по дням (рост): продажи/выручка предмета по датам.
export async function subjectByDate(subjectPath: string, d1: string, d2: string): Promise<SubjectDay[]> {
  const data = await post<SubjectDay[]>("/category/by_date", `d1=${d1}&d2=${d2}&path=${enc(subjectPath)}`, {});
  return Array.isArray(data) ? data : [];
}

// Запросы ниши с частотностью (wb_count) за период.
export async function subjectKeywords(subjectPath: string, d1: string, d2: string, limit = 400): Promise<NicheQuery[]> {
  const data = await post<{ queries?: NicheQuery[] }>("/category/keywords", `d1=${d1}&d2=${d2}&path=${enc(subjectPath)}`, { startRow: 0, endRow: limit });
  const q = data?.queries ?? [];
  return q.map((r) => ({ word: r.word, wb_count: Number(r.wb_count ?? 0), items_count: r.items_count }));
}

// Позиции нашего SKU по запросам (organic/ad) — для оси «запросы ↔ мы».
export async function itemKeywords(nmId: number, d1: string, d2: string): Promise<SkuKwRow[]> {
  const data = await post<{ data?: { words?: SkuKwRow[] } }>(`/items/${nmId}/keywords`, `d1=${d1}&d2=${d2}`, {});
  return data?.data?.words ?? [];
}
