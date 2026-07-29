// Тонкий клиент MPStats (рыночная аналитика WB) — ниши, частотность запросов, позиции.
// Токен в env MPSTATS_TOKEN (значение — из скилла ~/.agents/skills/mpstats/config/.env).
// Данные оценочные (MPStats занижает ~×2.3 по продажам) — для НАПРАВЛЕНИЯ/тренда, не абсолюта.
// Кэшируем через Next fetch revalidate, чтобы не жечь квоту (10k WB-вызовов).

const BASE = "https://mpstats.io/api/analytics/v1/wb";
const TTL = 6 * 3600; // 6ч кэш — рынок меняется медленно

export function hasMpstats(): boolean {
  return !!process.env.MPSTATS_TOKEN?.trim();
}

export type MpstatsErrorCode = "auth" | "rate_limit" | "upstream" | "network";

export class MpstatsApiError extends Error {
  constructor(
    message: string,
    readonly code: MpstatsErrorCode,
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "MpstatsApiError";
  }
}

export function mpstatsRouteError(error: unknown): { status: number; message: string } {
  if (!(error instanceof MpstatsApiError)) {
    return { status: 502, message: "MPSTATS недоступен" };
  }
  if (error.code === "auth") {
    return { status: 502, message: "MPSTATS: токен недействителен или истёк" };
  }
  if (error.code === "rate_limit") {
    return { status: 503, message: "MPSTATS: исчерпан лимит запросов, повторите позже" };
  }
  return { status: 502, message: error.message };
}

function token(): string | null {
  return process.env.MPSTATS_TOKEN?.trim() || null;
}

function retryDelay(res: Response, fallback: number): number {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10_000) : fallback;
}

async function post<T>(path: string, query: string, body: unknown, revalidate = TTL): Promise<T | null> {
  const authToken = token();
  if (!authToken) return null;
  const url = `${BASE}${path}${query ? `?${query}` : ""}`;
  let lastError: unknown = null;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "X-Mpstats-TOKEN": authToken, "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        next: { revalidate },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 401 || res.status === 403) {
        throw new MpstatsApiError("MPSTATS authorization failed", "auth", res.status);
      }
      if (res.status === 429) {
        lastError = new MpstatsApiError("MPSTATS: исчерпан лимит запросов", "rate_limit", 429);
        if (i < 3) await sleep(retryDelay(res, 1500));
        continue;
      }
      if (res.status === 202) {
        lastError = new MpstatsApiError("MPSTATS: данные ещё готовятся", "upstream", 202);
        if (i < 3) await sleep(retryDelay(res, 1500));
        continue;
      }
      if (!res.ok) throw new MpstatsApiError(`MPSTATS API ${res.status}`, "upstream", res.status);
      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof MpstatsApiError
        && (error.code === "auth" || (error.upstreamStatus != null && error.upstreamStatus < 500))) throw error;
      lastError = error;
      if (i < 3) await sleep(1200);
    }
  }
  if (lastError instanceof MpstatsApiError) throw lastError;
  if (lastError) throw new MpstatsApiError("MPSTATS: ошибка сети", "network");
  throw new MpstatsApiError("MPSTATS: исчерпан лимит запросов", "rate_limit", 429);
}

async function get<T>(path: string, revalidate = TTL): Promise<T | null> {
  const authToken = token();
  if (!authToken) return null;
  let lastError: unknown = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { "X-Mpstats-TOKEN": authToken, "Content-Type": "application/json" },
        next: { revalidate },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 401 || res.status === 403) {
        throw new MpstatsApiError("MPSTATS authorization failed", "auth", res.status);
      }
      if (res.status === 429) {
        lastError = new MpstatsApiError("MPSTATS: исчерпан лимит запросов", "rate_limit", 429);
        if (i < 2) await sleep(retryDelay(res, 1500));
        continue;
      }
      if (res.status === 202) {
        lastError = new MpstatsApiError("MPSTATS: данные ещё готовятся", "upstream", 202);
        if (i < 2) await sleep(retryDelay(res, 1500));
        continue;
      }
      if (!res.ok) throw new MpstatsApiError(`MPSTATS API ${res.status}`, "upstream", res.status);
      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof MpstatsApiError
        && (error.code === "auth" || (error.upstreamStatus != null && error.upstreamStatus < 500))) throw error;
      lastError = error;
      if (i < 2) await sleep(1000);
    }
  }
  if (lastError instanceof MpstatsApiError) throw lastError;
  if (lastError) throw new MpstatsApiError("MPSTATS: ошибка сети", "network");
  throw new MpstatsApiError("MPSTATS: исчерпан лимит запросов", "rate_limit", 429);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = (s: string) => encodeURIComponent(s);

export interface SubjectDay { period?: string; sales?: number; revenue?: number }
export interface NicheQuery { word: string; wb_count: number; items_count?: number }
export interface SkuKwRow { query: string; wb_count?: number; avg_organic_position?: number | null; avg_ad_position?: number | null }
export interface SubjectForecastDay {
  date?: string;
  yhat_sales?: number;
  yhat_lower_sales?: number;
  yhat_upper_sales?: number;
  real_sales?: number;
}
export interface SubjectAnnualSeasonality {
  date?: string;
  yearly_sales?: number;
  holidays_sales?: number;
  season_sales?: number;
}

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

// Предмет (ниша) товара: subject.id + subject.name — для авто-определения ниш кабинета.
export async function itemSubject(nmId: number): Promise<{ id: number; name: string } | null> {
  const data = await get<{ subject?: { id?: number; name?: string }; period_stats?: { subject_id?: number } }>(`/items/${nmId}/full`, 24 * 3600);
  const id = data?.subject?.id ?? data?.period_stats?.subject_id;
  const name = data?.subject?.name;
  return id ? { id, name: name || `Предмет ${id}` } : null;
}

// Ниша по дням по subject_id (предмет целиком, все деревья — точнее, чем category path).
export async function subjectByDateId(subjectId: number | string, d1: string, d2: string): Promise<SubjectDay[]> {
  const data = await post<SubjectDay[]>("/subject/by_date", `d1=${d1}&d2=${d2}&path=${subjectId}`, {});
  return Array.isArray(data) ? data : [];
}

// Запросы ниши по subject_id.
export async function subjectKeywordsId(subjectId: number | string, d1: string, d2: string, limit = 400): Promise<NicheQuery[]> {
  const data = await post<{ queries?: NicheQuery[] }>("/subject/keywords", `d1=${d1}&d2=${d2}&path=${subjectId}`, { startRow: 0, endRow: limit });
  return (data?.queries ?? []).map((r) => ({ word: r.word, wb_count: Number(r.wb_count ?? 0), items_count: r.items_count }));
}

// Рыночный прогноз продаж предмета. Используем только как относительный
// коэффициент к собственному факту, а не как абсолютный план кабинета.
export async function subjectForecastDaily(subjectId: number | string): Promise<SubjectForecastDay[]> {
  const data = await get<SubjectForecastDay[]>(`/subject/forecast/daily?path=${enc(String(subjectId))}`, 12 * 3600);
  return Array.isArray(data) ? data : [];
}

// Годовой профиль нужен как fallback для месяцев, которых ещё нет в
// горизонте ежедневного прогноза MPSTATS.
export async function subjectAnnualSeasonality(subjectId: number | string): Promise<SubjectAnnualSeasonality[]> {
  const data = await get<SubjectAnnualSeasonality[]>(`/subject/season_effects/annual?path=${enc(String(subjectId))}&period=month`, 24 * 3600);
  return Array.isArray(data) ? data : [];
}
