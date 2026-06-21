import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { HOOK_FORMULAS, HOOK_ANTIPATTERNS } from "@/lib/factory/standard";
import { brandProfile } from "@/lib/factory/brandProfiles";
import { nicheFromArticle, type ContentMode } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MODEL = "claude-sonnet-4-6";

// Хук-турнир: либо судит переданные хуки, либо сам генерит N (дешёвый текстовый шаг ДО дорогого рендера),
// затем ранжирует по «останавливает ли скролл» (паттерн-брейк/новизна/интрига), калиброванно на РЕАЛЬНО
// залетевших хуках ниши из корпуса (viral_hooks). Возвращает топ-1..2 победителей в рендер.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const article: string = (body.article || "").toString().trim();
  let name: string = (body.product_name || "").toString().trim();
  const mode: ContentMode = body.mode === "sell" ? "sell" : "audience";
  const want = Math.min(3, Math.max(1, Number(body.winners) || 2)); // сколько победителей вернуть
  const genCount = Math.min(60, Math.max(8, Number(body.count) || 12)); // сколько хуков генерить, если не передали
  let hooks: string[] = Array.isArray(body.hooks) ? body.hooks.map((x: unknown) => String(x || "").trim()).filter(Boolean).slice(0, 60) : [];

  if (!name && article) {
    const db = getSupabaseAdmin();
    if (db) { const { data } = await db.from("product_costs").select("name").eq("article", article).maybeSingle(); name = (data?.name as string) || ""; }
  }
  const subject = name || article;
  if (!subject && !hooks.length) return NextResponse.json({ error: "Нужен товар (артикул/название) или список хуков" }, { status: 400 });
  const niche = (["clothing", "toys", "cosmetics", "default"].includes(body.niche) ? body.niche : nicheFromArticle(article, name));
  const profile: string = (body.profile || "").toString().trim().slice(0, 1500) || brandProfile(article, name);

  // калибровка на корпусе: реально залетевшие хуки этой ниши+режима (таблица может ещё не существовать)
  let corpusHooks: string[] = [];
  try {
    const db = getSupabaseAdmin();
    if (db) {
      // калибровка niche-уровневая (mode-agnostic): берём проверенные хуки ниши независимо от режима —
      // их сеет niche-playbook (mode=null) и одобрения турнира; так таблица не пустует до R4/analyze_video.
      const { data } = await db.from("viral_hooks").select("hook_text").eq("niche", niche).order("viability_score", { ascending: false }).limit(8);
      corpusHooks = ((data as { hook_text: string }[] | null) ?? []).map((r) => r.hook_text).filter(Boolean);
    }
  } catch { /* корпуса ещё нет — судим без калибровки */ }
  const calib = corpusHooks.length
    ? `\n\nКАЛИБРОВКА — РЕАЛЬНО залетевшие хуки этой ниши (эталон силы, НЕ копируй дословно): ${corpusHooks.map((h) => `«${h}»`).join(" | ")}. Входной хук силён, если по паттерн-брейку/новизне/интриге НЕ слабее этих.`
    : "";

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  const sys = `Ты — судья ХУКОВ коротких вертикальных видео (Reels/Shorts/TikTok) бренда-селлера WB/Ozon. Судишь ОДНО: остановит ли первая фраза/первый кадр скролл за 1 секунду. Сильный хук = паттерн-брейк/новизна/интрига/эмоция/curiosity-gap, ≤12 слов, разговорный. Слабый = витрина/«здравствуйте»/общая польза/реклама-канцелярит.
${profile ? `ПРОФИЛЬ БРЕНДА/ЦА (под эту аудиторию): ${profile}\n` : ""}${HOOK_FORMULAS}
${HOOK_ANTIPATTERNS}${calib}
Режим: ${mode === "sell" ? "ПРОДАЖА (ведём на WB)" : "АУДИТОРИЯ (рост охвата)"}. Ниша: ${niche}.
Суди СТРОГО, не из вежливости — это конкуренция в ленте. Для каждого хука: score 1-10 (останавливает ли скролл), pattern (pattern_break|curiosity_gap|surprise|problem|demo|other), why (≤10 слов).
Верни СТРОГО JSON: {"ranked":[{"hook":"...","score":8,"pattern":"...","why":"..."}]}. Отсортируй по score убыв. Только JSON, без преамбулы.`;

  // если хуков не дали — генерим genCount штук под товар (дешёвый шаг)
  let genNote = "";
  if (!hooks.length) {
    const calibForGen = corpusHooks.length ? `\nПРИМЕРЫ ЗАЛЕТЕВШИХ ХУКОВ НИШИ (изучи паттерн, НЕ копируй): ${corpusHooks.slice(0, 5).map((h) => `«${h}»`).join(" | ")}` : "";
    const genSys = `Ты топ-маркетолог UGC. Дай ${genCount} РАЗНЫХ хуков (первых фраз) под товар, каждый по своей формуле, ≤12 слов, разговорный, паттерн-брейк/интрига/боль. БЕЗ вступлений-пустышек. ${HOOK_FORMULAS}${calibForGen}\nВерни СТРОГО JSON-массив строк. Только JSON.`;
    try {
      const gr = await client.messages.create({ model: MODEL, max_tokens: 1500, system: genSys, messages: [{ role: "user", content: `Товар: ${subject}${article ? ` (арт. ${article})` : ""}. Дай ${genCount} хуков.` }] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = (gr.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
      const m = t.match(/\[[\s\S]*\]/);
      if (m) hooks = (JSON.parse(m[0]) as unknown[]).map((x) => String(x || "").trim()).filter(Boolean).slice(0, genCount);
    } catch { /* падать не будем — ниже отдадим ошибку, если хуков нет */ }
    genNote = "generated";
    if (!hooks.length) return NextResponse.json({ error: "не удалось сгенерировать хуки" }, { status: 502 });
  }

  const user = `Товар: ${subject}. Оцени и отранжируй эти ${hooks.length} хуков:\n${hooks.map((h, i) => `${i + 1}. ${h}`).join("\n")}`;
  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 2000, system: sys, messages: [{ role: "user", content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "пустой вердикт судьи", raw: txt.slice(0, 150) }, { status: 502 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ranked: any[] = [];
    try { ranked = (JSON.parse(m[0]).ranked || []) as any[]; } catch { return NextResponse.json({ error: "невалидный JSON судьи" }, { status: 502 }); }
    ranked = ranked.map((r) => ({ hook: String(r.hook || ""), score: Math.max(1, Math.min(10, Number(r.score) || 1)), pattern: String(r.pattern || "other"), why: String(r.why || "") }))
      .filter((r) => r.hook).sort((a, b) => b.score - a.score);
    const winners = ranked.slice(0, want);

    // Авто-сид: хуки score>=8 → viral_hooks viability_score=3 (AI-турнирные, хуже real-corpus но лучше ничего)
    // Это гарантирует что hook-judge не работает вхолостую: каждый прогон обогащает корпус.
    // Для уже существующих viability=2 (from analyze_video) — апгрейд до 3. Не перебиваем 4/5.
    const toSeed = ranked.filter((r) => r.score >= 8).slice(0, 5);
    if (toSeed.length) {
      const db = getSupabaseAdmin();
      if (db) {
        await Promise.allSettled(toSeed.map(async (r) => {
          try {
            const note = `hook-judge ${r.pattern} score=${r.score}`;
            const hookSlice = r.hook.toString().slice(0, 300);
            const { error: ie } = await db.from("viral_hooks").insert({ niche, hook_text: hookSlice, viability_score: 3, effectiveness_notes: note });
            if (ie?.code === "23505") {
              // хук уже есть — обновляем только если viability < 3 (не перебиваем OTK=4 или winners=5)
              await db.from("viral_hooks").update({ viability_score: 3, effectiveness_notes: note })
                .eq("niche", niche).eq("hook_text", hookSlice).lt("viability_score", 3);
            }
          } catch { /* corpus optional */ }
        }));
      }
    }

    return NextResponse.json({ niche, mode, source: genNote || "provided", calibrated: corpusHooks.length > 0, count: ranked.length, winners, ranked, seeded: toSeed.length });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
