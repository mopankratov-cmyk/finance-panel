import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { CONTENT_STANDARD, HOOK_FORMULAS, HOOK_ANTIPATTERNS, DEAI_FILTERS, PROBLEM_STACK, QA_THRESHOLD } from "@/lib/factory/standard";
import { brandProfile } from "@/lib/factory/brandProfiles";
import { extractJsonArray } from "@/lib/factory/extractJson";
import { loadImprovementSnapshot, type ImprovementBatchPlan } from "@/lib/factory/improvementLoop";
import { batchPlanHintFor, improvementHintFor } from "@/lib/factory/learningHints";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Копирайтер: быстрый Sonnet, один вызов — генерит N сценариев И сам оценивает каждый по стандарту
// (self-QA: score/verdict/fix). Брак (< порога) → verdict "rework". Укладывается в лимит функции.
const MODEL = "claude-sonnet-4-6";

export async function POST(req: NextRequest) {
 try {
  const body = await req.json().catch(() => ({}));
  const article: string = (body.article || "").toString().trim();
  let name: string = (body.product_name || "").toString().trim();
  const count = Math.min(15, Math.max(2, Number(body.count) || 10));
  const brief: string = (body.brief || "").toString().trim();
  const competitorBrief: string = (body.competitor_brief || "").toString().trim();
  let profile: string = (body.profile || "").toString().trim().slice(0, 2000);
  // отклонённое оператором — обучение «что НЕ выпускать» (петля обратной связи с человеком)
  const rejects: string[] = Array.isArray(body.rejects) ? body.rejects.slice(0, 20).map((x: unknown) => String(x)).filter(Boolean) : [];
  const rejHint = rejects.length
    ? `\n\nОТКЛОНЕНО ОПЕРАТОРОМ РАНЕЕ (он забраковал готовый контент с этими идеями/хуками — НЕ делай похожие по смыслу/структуре, ищи другие углы): ${rejects.slice(0, 15).join(" | ")}`
    : "";
  // плейбук ниши (из «Изучить нишу») — РЕАЛЬНО залетающее: на этом строим идеи (research-first)
  const pb = body.playbook && typeof body.playbook === "object" ? body.playbook : null;

  const fmts: any[] = pb && Array.isArray(pb.winning_formats) ? pb.winning_formats : [];
  const pbHint = pb
    ? `\n\nПЛЕЙБУК НИШИ (данные Virlo — что РЕАЛЬНО залетает; СТРОЙ идеи на этом, адаптируя под товар):` +
      (pb.summary ? `\nСуть: ${String(pb.summary).slice(0, 300)}` : "") +
      (fmts.length
        ? `\nФорматы-победители (бери структуру, а не название): ` +
          fmts.slice(0, 4).map((f) =>
            `«${f.name}»` +
            (f.structure_by_seconds ? ` [${String(f.structure_by_seconds).slice(0, 80)}]` : (Array.isArray(f.beats) ? ` [${f.beats.join("→")}]` : "")) +
            (f.psycho_trigger ? ` (триггер: ${f.psycho_trigger})` : "")
          ).join(" | ")
        : "") +
      (Array.isArray(pb.hooks) && pb.hooks.length ? `\nРабочие хуки ниши (адаптируй, не копируй дословно): ${pb.hooks.slice(0, 7).join(" | ")}` : "") +
      (Array.isArray(pb.anti_patterns) && pb.anti_patterns.length ? `\nНЕ делай (анти-паттерны ниши): ${pb.anti_patterns.slice(0, 4).join("; ")}` : "")
    : "";

  const db = getSupabaseAdmin();
  if (!name && article && db) {
    // limit(1)+[0], НЕ maybeSingle(): при дублях артикула maybeSingle бросает «multiple rows» → краш функции
    try {
      const { data } = await db.from("product_costs").select("name").eq("article", article).limit(1);
      name = ((data as { name: string }[] | null)?.[0]?.name) || "";
    } catch { /* product_costs может отсутствовать — не критично */ }
  }
  const subject = name || article;
  if (!subject) return NextResponse.json({ error: "Нужен артикул или название товара" }, { status: 400 });
  // профиль не задан вручную → подбираем по БРЕНДУ товара (1 бренд = 1 профиль)
  if (!profile) profile = brandProfile(article, name);

  // P2.1 Winners loop: подтягиваем наши зашедшие ролики по нише → копирайтер строит вариации
  let winnersHint = "";
  let batchImprovementHint = "";
  let batchPlanHint = "";
  let batchPlan: ImprovementBatchPlan | null = null;
  if (db && article) {
    try {
      const { nicheFromArticle } = await import("@/lib/factory/rubric");
      const niche = nicheFromArticle(article, name);
      if (niche) {
        const snapshot = await loadImprovementSnapshot(db, { niche, target_runs: 50, batch_size: 5 });
        batchPlan = snapshot.batch_plan || null;
        batchImprovementHint = await improvementHintFor(db, niche);
        batchPlanHint = await batchPlanHintFor(db, niche);
        const { data: wins } = await db.from("content_assets")
          .select("winner_learnings,name")
          .eq("niche", niche).eq("is_winner", true)
          .order("winner_at", { ascending: false }).limit(5);
        const list = (wins || [])
          .map((w) => {
            const l = (w.winner_learnings || {}) as Record<string, unknown>;
            const hook = String(l.hook || w.name || "").slice(0, 80);
            const fmt = String(l.format || l.route || "").slice(0, 30);
            const views = l.views ? ` (${Number(l.views).toLocaleString("ru")} просмотров)` : "";
            return hook ? `«${hook}» [${fmt || "неизв"}]${views}` : null;
          })
          .filter(Boolean);
        if (list.length) {
          winnersHint = `\n\nНАШИ ПОБЕДИТЕЛИ В НИШЕ (реально залетело у этого бренда — бери дух/механику, меняй по одному рычагу, не копируй дословно): ${list.join(" | ")}`;
        }
      }
    } catch { /* winners-таблица может ещё не существовать */ }
  }

  // Прямая калибровка корпусных хуков: если плейбука нет — берём из viral_hooks напрямую
  // (плейбук тоже читает их, но только когда пользователь явно запустил «Изучить нишу»)
  let corpusHookHint = "";
  if (!pb && db && article) {
    try {
      const { nicheFromArticle } = await import("@/lib/factory/rubric");
      const rn = nicheFromArticle(article, name);
      if (rn) {
        const { data: chks } = await db.from("viral_hooks").select("hook_text,viability_score").eq("niche", rn).order("viability_score", { ascending: false }).limit(10);
        const hooks = ((chks as { hook_text: string; viability_score: number }[] | null) ?? []).map((h) => h.hook_text).filter(Boolean);
        if (hooks.length) corpusHookHint = `\n\nКОРПУС ХУКОВ НИШИ (проверены реальными просмотрами — возьми ДУХ/ПАТТЕРН, не копируй дословно): ${hooks.map((h) => `«${h}»`).join(" | ")}`;
      }
    } catch { /* corpus optional */ }
  }

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  const sys = `Ты топ-маркетолог UGC-видео для Wildberries/Ozon И строгий QA-директор. Пишешь сценарии коротких вертикальных видео (Reels/Shorts/TikTok) под охват И переходы на карточку, потом сам оцениваешь каждый по стандарту.
${profile ? `ПРОФИЛЬ БРЕНДА/АУДИТОРИИ (пиши в этом голосе, под эту ЦА):\n${profile}\n` : ""}СТАНДАРТ: ${CONTENT_STANDARD}
${HOOK_FORMULAS}
${HOOK_ANTIPATTERNS}
${DEAI_FILTERS}
${PROBLEM_STACK}
Сделай разные хуки/форматы/углы — КАЖДЫЙ хук по своей формуле, не повторяй структуру. Хотя бы 1-2 идеи из набора сделай в формате «3 проблемы» (format: "проблема-стек"). Это БЫСТРАЯ идеация — НЕ пиши покадровый сценарий, только идею. Полный сценарий развернём отдельно для выбранных. Оценивай СТРОГО как придирчивый редактор: для КАЖДОГО честно поставь score 1-10 по стандарту, анти-паттернам И фильтрам анти-ИИ; если < ${QA_THRESHOLD} или текст пахнет нейронкой — verdict "rework" и в fix конкретно что исправить (не общими словами).
Если в контексте есть BATCH PLAN, соблюдай его буквально: control-идеи должны держать найденный паттерн, experiment-идеи могут менять только одну axis.
Верни СТРОГО JSON-массив (кратко): [{"hook":"первая фраза-зацепка ≤12 слов","angle":"какое возражение","concept":"идея ролика 1-2 предложения","retention":"0-2 хук→2-5 конфликт→5-10 решение→payoff","caption":"подпись","format":"unboxing|POV|обзор|до/после|лайфхак|проблема-решение|reveal|реакция","cta":"кратко","batch_role":"control|experiment","change_axis":"none|hook_angle|proof_density|cta_shape|format","score":8,"verdict":"approved|rework","fix":""}]. Только JSON, без преамбулы. РАЗНООБРАЗИЕ: минимум 4 разных format и 4 разных hook_type в наборе.`;

  const user = `Товар: ${subject}${article ? ` (артикул ${article})` : ""}. Сделай ${count} сценариев.` +
    (brief ? ` Бриф: ${brief}.` : "") + (competitorBrief ? ` Разведка конкурентов: ${competitorBrief}.` : "") + pbHint + winnersHint + corpusHookHint + rejHint + batchImprovementHint + batchPlanHint;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 8000, system: sys, messages: [{ role: "user", content: user }] });

    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    let scripts = (extractJsonArray(txt) as Record<string, unknown>[] | null) || [];
    if (!scripts.length) return NextResponse.json({ error: "копирайтер не вернул сценариев", raw: txt.slice(0, 200) }, { status: 502 });
    // нормализация verdict по порогу
    scripts = scripts.map((s, idx) => {
      const sc = Number(s.score) || 6;
      const rawRole = String(s.batch_role || "").toLowerCase();
      const defaultControlCount = Math.max(1, Math.min(2, Number(batchPlan?.control_count) || Math.min(2, Math.max(1, Math.floor(count / 3)))));
      const batchRole = rawRole === "control" || rawRole === "experiment" ? rawRole : (idx < defaultControlCount ? "control" : "experiment");
      const rawAxis = String(s.change_axis || "").toLowerCase();
      const defaultAxis = String(batchPlan?.primary_change_axis || "hook_angle");
      const changeAxis = ["none", "hook_angle", "proof_density", "cta_shape", "format"].includes(rawAxis) ? rawAxis : (batchRole === "control" ? "none" : defaultAxis);
      return { ...s, batch_role: batchRole, change_axis: changeAxis, score: sc, verdict: sc >= QA_THRESHOLD ? "approved" : "rework", fix: sc >= QA_THRESHOLD ? "" : (s.fix || "усилить хук/аутентичность") };
    });
    scripts.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const approved = scripts.filter((s) => s.verdict !== "rework").length;
    return NextResponse.json({ article, product: subject, count: scripts.length, approved_count: approved, rework_count: scripts.length - approved, ensemble: "claude-sonnet (self-QA)", batch_plan: batchPlan, scripts });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
 } catch (outer) {
  // ВСЁ обёрнуто: любой сбой (DB/инициализация/таймаут-обработка) → JSON, а не платформенный «An error occurred»
  return NextResponse.json({ error: "scripts crash: " + String((outer as Error)?.message || outer).slice(0, 180) }, { status: 500 });
 }
}
