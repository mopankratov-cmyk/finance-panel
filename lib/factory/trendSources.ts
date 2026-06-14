// Авто-источники залетевших видео для Трендоскопа. Провайдер-абстракция: Apify / Virlo.
// Вызовы идут с нашего сервера; скрап выполняется у провайдера (гео-блок РФ не мешает).
// Активируется ключом: APIFY_TOKEN (+APIFY_ACTOR) или VIRLO_API_KEY. Trendsee — позже, если дадут API.

export interface ViralVideo { url?: string; caption?: string; title?: string; views?: number; likes?: number }

export function hasTrendSource(): boolean {
  return !!(process.env.APIFY_TOKEN || process.env.VIRLO_API_KEY);
}
export function trendSourceName(): string {
  if (process.env.APIFY_TOKEN) return "apify";
  if (process.env.VIRLO_API_KEY) return "virlo";
  return "none";
}

const num = (v: unknown) => (Number(v) || 0);

// Apify: запускаем актор синхронно и забираем dataset. Актор задаётся APIFY_ACTOR
// (по умолч. TikTok trending scraper). Вход — общий, лишние поля актор игнорит.
async function fromApify(niche: string, limit: number): Promise<ViralVideo[]> {
  const token = process.env.APIFY_TOKEN!;
  const actor = process.env.APIFY_ACTOR || "lexis-solutions~tiktok-trending-videos-scraper";
  const input = { searchQueries: [niche], search: niche, keyword: niche, hashtags: [niche.replace(/\s+/g, "")], maxItems: limit, resultsPerPage: limit, countryCode: "RU" };
  try {
    const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&maxItems=${limit}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(55000),
    });
    if (!r.ok) return [];
    const items = (await r.json()) as Record<string, unknown>[];
    return (Array.isArray(items) ? items : []).slice(0, limit).map((it) => ({
      url: (it.webVideoUrl || it.url || it.postPage || "") as string,
      caption: (it.text || it.caption || it.title || it.desc || "") as string,
      views: num(it.playCount ?? it.views ?? it.viewCount),
      likes: num(it.diggCount ?? it.likes ?? it.likeCount),
    })).filter((v) => v.caption || v.url);
  } catch { return []; }
}

// Virlo: trends/virality API (best-effort; точная схема уточняется по их докам).
async function fromVirlo(niche: string, limit: number): Promise<ViralVideo[]> {
  const key = process.env.VIRLO_API_KEY!;
  try {
    const r = await fetch(`https://api.virlo.ai/v1/trends?query=${encodeURIComponent(niche)}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: Record<string, unknown>[]; results?: Record<string, unknown>[] };
    const arr = j.data || j.results || [];
    return arr.slice(0, limit).map((it) => ({
      url: (it.url || it.videoUrl || "") as string,
      caption: (it.title || it.caption || it.description || "") as string,
      views: num(it.views ?? it.viewCount),
      likes: num(it.likes),
    })).filter((v) => v.caption || v.url);
  } catch { return []; }
}

export async function fetchViral(niche: string, limit = 20): Promise<ViralVideo[]> {
  if (process.env.APIFY_TOKEN) return fromApify(niche, limit);
  if (process.env.VIRLO_API_KEY) return fromVirlo(niche, limit);
  return [];
}
