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

// Virlo через MCP (Streamable HTTP, JSON-RPC). VIRLO_API_KEY = токен, VIRLO_MCP_URL — эндпоинт.
async function virloCall(method: string, params: unknown): Promise<unknown> {
  const key = process.env.VIRLO_API_KEY!;
  const url = process.env.VIRLO_MCP_URL || "https://dev.virlo.ai/api/mcp/mcp";
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(50000),
  });
  const t = await r.text();
  const line = t.split("\n").find((l) => l.startsWith("data:"));
  try { return JSON.parse(line ? line.slice(5).trim() : t); } catch { return null; }
}

async function fromVirlo(niche: string, limit: number): Promise<ViralVideo[]> {
  try {
    await virloCall("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "factory", version: "1" } });
    const res = (await virloCall("tools/call", { name: "get_trending_videos", arguments: { platform: "tiktok", limit, query: niche || undefined } })) as { result?: { content?: { type: string; text?: string }[] } } | null;
    const textBlock = res?.result?.content?.find((b) => b.type === "text")?.text;
    if (!textBlock) return [];
    const data = (JSON.parse(textBlock) as { data?: Record<string, unknown>[] }).data || [];
    return data.slice(0, limit).map((it) => ({
      url: (it.url || "") as string,
      caption: (it.description || "") as string,
      views: num(it.views),
      likes: num(it.number_of_likes ?? it.likes),
    })).filter((v) => v.caption || v.url);
  } catch { return []; }
}

export async function fetchViral(niche: string, limit = 20): Promise<ViralVideo[]> {
  if (process.env.APIFY_TOKEN) return fromApify(niche, limit);
  if (process.env.VIRLO_API_KEY) return fromVirlo(niche, limit);
  return [];
}
