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

// ── Virlo Orbit: продукт-ориентированный поиск по ключевым фразам (асинхронный) ──
async function virloInitCall(method: string, params: unknown): Promise<unknown> {
  await virloCall("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "factory", version: "1" } });
  return virloCall(method, params);
}
function virloToolJson(res: unknown): Record<string, unknown> | null {
  const t = (res as { result?: { content?: { type: string; text?: string }[] } } | null)?.result?.content?.find((b) => b.type === "text")?.text;
  if (!t) return null;
  try { return JSON.parse(t) as Record<string, unknown>; } catch { return null; }
}
// Остаток баланса Virlo (get_credit_balance — бесплатный вызов). Тот же серверный путь, что и остальные
// вызовы Virlo (MCP-over-HTTP, VIRLO_API_KEY). Ответ: { balance:"$15.00", credits_remaining:1500, status }.
// Возвращаем USD-баланс (парсим "$15.00" → 15; фолбэк credits_remaining/100) + сырой ответ.
export async function virloBalance(): Promise<{ balance: number | null; currency: string; raw?: unknown; error?: string }> {
  if (!process.env.VIRLO_API_KEY) return { balance: null, currency: "USD", error: "VIRLO_API_KEY не настроен" };
  try {
    const res = await virloInitCall("tools/call", { name: "get_credit_balance", arguments: {} });
    const j = virloToolJson(res);
    if (!j) return { balance: null, currency: "USD", error: "Virlo вернул пустой/непарсируемый ответ" };
    const balStr = j.balance != null ? String(j.balance).replace(/[^0-9.\-]/g, "") : "";
    let n = Number(balStr);
    if (!Number.isFinite(n) && j.credits_remaining != null) n = Number(j.credits_remaining) / 100; // 1 credit = $0.01
    if (!Number.isFinite(n)) return { balance: null, currency: "USD", error: "поле баланса не найдено", raw: j };
    return { balance: n, currency: "USD", raw: j };
  } catch (e) { return { balance: null, currency: "USD", error: String(e).slice(0, 140) }; }
}

// Запустить Orbit-поиск по фразам. Возвращает job_id (или null).
export async function virloSearchStart(keywords: string[], platforms: string[] = ["tiktok", "youtube", "instagram"], period = "this_month"): Promise<string | null> {
  if (!process.env.VIRLO_API_KEY) return null;
  const res = await virloInitCall("tools/call", { name: "search_keywords", arguments: { name: `factory ${keywords[0] || ""}`.slice(0, 60), keywords: keywords.slice(0, 7), time_period: period, platforms } });
  const j = virloToolJson(res);
  const data = (j?.data as Record<string, unknown>) || j;
  return (data?.id || data?.job_id || null) as string | null;
}
// Забрать результат/статус Orbit. dataType: status|videos|analysis|trends|outliers.
// extraArgs — для пагинации видео (limit/offset): ответ videos приходит как { data: { total, limit:50, offset, videos:[...] } },
// поэтому орбиты с >50 видео (у нас есть 110 и 127) нужно тянуть страницами через offset.
export async function virloSearchResult(id: string, dataType = "status", extraArgs: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
  if (!process.env.VIRLO_API_KEY) return null;
  const res = await virloInitCall("tools/call", { name: "get_keyword_search_results", arguments: { id, data_type: dataType, ...extraArgs } });
  return virloToolJson(res);
}

export async function fetchViral(niche: string, limit = 20): Promise<ViralVideo[]> {
  if (process.env.APIFY_TOKEN) return fromApify(niche, limit);
  if (process.env.VIRLO_API_KEY) return fromVirlo(niche, limit);
  return [];
}

// ── Virlo: list existing orbits (reads free) ────────────────────────────────────────────────────────
export async function virloListOrbits(limit = 50): Promise<{ id: string; name: string; status: string; totalVideos: number }[]> {
  if (!process.env.VIRLO_API_KEY) return [];
  try {
    const res = await virloInitCall("tools/call", { name: "list_keyword_searches", arguments: { limit } });
    const j = virloToolJson(res);
    const data = (j?.data as Record<string, unknown>) || {};
    const orbits = Array.isArray((data as Record<string, unknown>).orbits) ? ((data as Record<string, unknown>).orbits as { id: string; name: string; status: string; totalVideos: number }[]) : [];
    return orbits;
  } catch { return []; }
}

// ── Virlo: niche monitors ──────────────────────────────────────────────────────────────────────────

// Создать Comet-монитор для ниши (однократно, платный шаг ~$1-2).
// Возвращает monitor_id или null.
export interface VirloCreateResult { id: string | null; error?: string; }
export async function virloCreateMonitor(niche: string, keywords: string[], platforms = ["tiktok", "instagram"]): Promise<VirloCreateResult> {
  if (!process.env.VIRLO_API_KEY) return { id: null, error: "VIRLO_API_KEY не настроен" };
  try {
    const res = await virloInitCall("tools/call", { name: "create_niche_monitor", arguments: { name: `wb-factory-${niche}`, keywords: keywords.slice(0, 7), platforms, frequency: "weekly" } });
    // MCP-level error (JSON-RPC error) — surface it instead of swallowing into null.
    const rpcErr = (res as { error?: { message?: string } } | null)?.error?.message;
    if (rpcErr) return { id: null, error: `Virlo MCP error: ${String(rpcErr).slice(0, 160)}` };
    const j = virloToolJson(res);
    if (!j) return { id: null, error: "Virlo вернул пустой/непарсируемый ответ (нет text-блока)" };
    if (j.error) return { id: null, error: `Virlo error: ${String(j.error).slice(0, 160)}` };
    const data = ((j.data as Record<string, unknown>) || j) as Record<string, unknown>;
    if (data.error) return { id: null, error: `Virlo error: ${String(data.error).slice(0, 160)}` };
    // id монитора может лежать как data.id или data.monitor_id (или вложен в data.monitor.* — терпим и это).
    const monitor = (data.monitor && typeof data.monitor === "object" ? (data.monitor as Record<string, unknown>) : null);
    const id = data.id ?? data.monitor_id ?? monitor?.id ?? monitor?.monitor_id ?? null;
    if (id == null) return { id: null, error: `monitor_id не найден; ключи ответа: [${Object.keys(data).slice(0, 8).join(", ")}]` };
    return { id: String(id) };
  } catch (e) { return { id: null, error: String(e).slice(0, 160) }; }
}

// Список существующих Comet-мониторов (читает бесплатно).
export async function virloListMonitors(): Promise<{ id: string; name: string; status: string }[]> {
  if (!process.env.VIRLO_API_KEY) return [];
  try {
    const res = await virloInitCall("tools/call", { name: "list_niche_monitors", arguments: {} });
    const j = virloToolJson(res);
    // Дамп вернул пусто → форма не подтверждена. Терпим ОБА варианта: { data: [...] } и { data: { monitors: [...] } }
    // (последнее зеркалит подтверждённый list_keyword_searches → data.orbits).
    const d = (j as Record<string, unknown> | null)?.data;
    const arr = Array.isArray(d)
      ? d
      : (d && typeof d === "object" && Array.isArray((d as Record<string, unknown>).monitors) ? (d as Record<string, unknown>).monitors : []);
    const data = arr as { id: string; name: string; status: string }[];
    return data.filter((m) => m && m.id);
  } catch { return []; }
}

// Данные монитора: новые видео из Comet с момента last_checked (читает бесплатно).
export async function virloMonitorData(monitorId: string): Promise<Record<string, unknown>[]> {
  if (!process.env.VIRLO_API_KEY) return [];
  try {
    const res = await virloInitCall("tools/call", { name: "get_niche_monitor_data", arguments: { id: monitorId } });
    const j = virloToolJson(res);
    // По общему правилу дампа массив лежит на один уровень глубже под именованным ключом (зеркало data.videos).
    // Терпим: { data: [...] }, { data: { videos: [...] } } и { data: { data: [...] } }.
    const d = (j as Record<string, unknown> | null)?.data;
    const arr = Array.isArray(d)
      ? d
      : (d && typeof d === "object"
          ? (Array.isArray((d as Record<string, unknown>).videos) ? (d as Record<string, unknown>).videos
            : Array.isArray((d as Record<string, unknown>).data) ? (d as Record<string, unknown>).data
            : [])
          : []);
    return arr as Record<string, unknown>[];
  } catch { return []; }
}

// ── Virlo: deep video analysis ────────────────────────────────────────────────────────────────────

export interface VirloVideoAnalysis {
  hook_text?: string;
  format_detected?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beat_structure?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viral_reason?: any;
  is_commerce_safe?: boolean;
}

// Глубокий анализ видео: hook_text, формат, beat_structure, причина вирусности (читает бесплатно).
export async function virloAnalyzeVideo(url: string): Promise<VirloVideoAnalysis | null> {
  if (!process.env.VIRLO_API_KEY) return null;
  try {
    const res = await virloInitCall("tools/call", { name: "analyze_video", arguments: { url } });
    const j = virloToolJson(res);
    if (!j || j.error) return null;
    // Как и все вызовы Virlo, payload завёрнут в .data; падаем на j, если .data нет (analyze_video в дампе не снят).
    const data = ((j.data as Record<string, unknown>) || j) as Record<string, unknown>;
    if (!data || data.error) return null;
    return {
      hook_text: (data.hook_text || data.hook || "") as string,
      format_detected: (data.format || data.format_detected || data.content_type || "") as string,
      beat_structure: data.beat_structure || data.beats || null,
      viral_reason: data.viral_reason || data.why_viral || null,
      is_commerce_safe: typeof data.is_commerce_safe === "boolean" ? data.is_commerce_safe : true,
    };
  } catch { return null; }
}
