import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { internalFetch } from "@/lib/internalFetch";
import { buildReelProps } from "@/lib/factory/graphRun";
import type { RunPlan } from "@/lib/factory/graphTypes";
import { remotionReady, remotionSubmit, remotionStatus } from "@/lib/factory/remotionRender";
import { selectVisualNodes, cloneNodesWithHook, reorderVisual, patchVariantProps, sanitizeVariant, type ReelVariant } from "@/lib/factory/reelVariants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// «1 генерация → N монтажей» (reuse). Берёт рецепт с УЖЕ сгенерёнными клипами (run_plan.nodes[].url)
// и рендерит R разных рилсов, варьируя хук/порядок/звук/акцент — БЕЗ перегенерации (только дешёвый рендер).
// Амортизирует дорогой слой (fal/creatify/eleven) по R → юнитка ≈ gen/R. Стоит ТОЛЬКО при FACTORY на Remotion.
// Отдельный роут + таблица reel_variants (render_id на строку) → НЕ трогает денежный self-chaining graphRun
// и обходит гонку run_plan.renders[] / 1:1 render-poll.
//   POST { recipe_id, variants:[{hook?,overlayOrder?,audioSrc?,accent?,ctaTitle?,ctaButton?}], dry_run? }
//        → { ok, recipe_id, submitted:[{variant_idx, render_id, hook}], dry?, props? }
//   GET  ?recipe_id=N → опрашивает рендеры вариантов, банкует готовые (gen-save) → { ok, variants:[…] }

const MAX_VARIANTS = 12;

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    if (!remotionReady()) return NextResponse.json({ ok: false, error: "REMOTION_RENDER_URL не задан — reuse рендерит через Remotion-VM" }, { status: 400 });

    const b = await req.json().catch(() => ({}));
    const recipeId = Number(b.recipe_id) || 0;
    const dryRun = b.dry_run === true;
    const force = b.force === true;
    if (!recipeId) return NextResponse.json({ ok: false, error: "нужен recipe_id" }, { status: 400 });
    // санитайз входа (клэмп длин/типов/http-аудио) — мусор не попадёт в пропсы рендера
    const variants: ReelVariant[] = Array.isArray(b.variants) ? (b.variants as ReelVariant[]).slice(0, MAX_VARIANTS).map(sanitizeVariant) : [];
    if (!variants.length) return NextResponse.json({ ok: false, error: "нужен непустой variants:[] (хотя бы один вариант)" }, { status: 400 });

    // ИДЕМПОТЕНТНОСТЬ: ретрай POST (таймаут/сеть) не должен повторно сабмитить рендеры. Если для рецепта уже
    // есть варианты в полёте (rendering/banking) — возвращаем их, не платим повторно (force=true обходит).
    if (!dryRun && !force) {
      const { data: inflight } = await db.from("reel_variants").select("variant_idx,render_id,status,video_url").eq("recipe_id", recipeId).in("status", ["rendering", "banking"]);
      const rows = (inflight as Record<string, unknown>[] | null) || [];
      if (rows.length) return NextResponse.json({ ok: true, recipe_id: recipeId, already_inflight: true, submitted: rows, note: `Для рецепта уже идут ${rows.length} рендер(ов) — не пересабмичу (force=true чтобы заставить).` });
    }

    // рецепт + его сгенерённые ассеты из run_plan (НЕ переген — берём готовые url)
    const { data: recRows } = await db.from("node_recipes").select("id,article,niche,run_plan").eq("id", recipeId).limit(1);
    const rec = (recRows as Record<string, unknown>[] | null)?.[0];
    if (!rec) return NextResponse.json({ ok: false, error: "рецепт не найден" }, { status: 404 });
    const plan = (rec.run_plan as RunPlan) || null;
    const baseNodes = plan?.nodes || [];
    const baseVisual = selectVisualNodes(baseNodes);
    if (!baseVisual.length) return NextResponse.json({ ok: false, error: "у рецепта нет готовых клипов в run_plan — сначала прогенери его (gen-poll → done)" }, { status: 400 });
    const article = String(rec.article || "");
    const niche = String(rec.niche || "");

    // строим пропсы каждого варианта из ОДНИХ клипов (reuse), затем сабмитим рендер
    const submitted: { variant_idx: number; render_id: string | null; hook?: string; status: string }[] = [];
    const dryProps: { variant_idx: number; props: Record<string, unknown> }[] = [];
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i] || {};
      const nodes2 = cloneNodesWithHook(baseNodes, v.hook);
      const visual = reorderVisual(selectVisualNodes(nodes2), v.overlayOrder);
      const { inputProps, durationInFrames } = buildReelProps({ ...(plan as RunPlan), nodes: nodes2 }, visual, article);
      const props = patchVariantProps(inputProps, v);
      if (dryRun) { dryProps.push({ variant_idx: i, props }); continue; }

      const renderId = await remotionSubmit("ReelV5", props, durationInFrames);
      if (!renderId) console.error(`[reel-recompose] remotionSubmit вернул null (recipe ${recipeId} variant ${i}) — проверь REMOTION_RENDER_URL/токен/живость VM`);
      // одна строка на вариант — свой render_id, без гонки за общий массив
      await db.from("reel_variants").insert({
        recipe_id: recipeId, variant_idx: i, hook: v.hook || null,
        render_id: renderId, status: renderId ? "rendering" : "error",
        video_url: null, props,
      });
      submitted.push({ variant_idx: i, render_id: renderId, hook: v.hook, status: renderId ? "rendering" : "error" });
    }

    if (dryRun) return NextResponse.json({ ok: true, dry: true, recipe_id: recipeId, count: variants.length, props: dryProps });
    return NextResponse.json({ ok: true, recipe_id: recipeId, submitted, note: `${submitted.filter((s) => s.render_id).length}/${variants.length} вариантов в рендере. Банк: GET ?recipe_id=${recipeId} (после готовности).`, niche });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "пересборка рила упала: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}

// Опрос + банк готовых вариантов. Идемпотентно: CAS-claim rendering→banking перед gen-save (без двойного банка).
export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const recipeId = Number(req.nextUrl.searchParams.get("recipe_id")) || 0;
    if (!recipeId) return NextResponse.json({ ok: false, error: "нужен ?recipe_id" }, { status: 400 });

    const { data: rows } = await db.from("reel_variants").select("id,variant_idx,hook,render_id,status,video_url").eq("recipe_id", recipeId).order("variant_idx");
    const variants = (rows as Record<string, unknown>[] | null) || [];
    const { data: recRows } = await db.from("node_recipes").select("article,niche").eq("id", recipeId).limit(1);
    const rec = (recRows as Record<string, unknown>[] | null)?.[0] || {};
    const article = String(rec.article || ""); const niche = String(rec.niche || "");

    for (const r of variants) {
      if (r.status !== "rendering" || !r.render_id) continue;
      const s = await remotionStatus(String(r.render_id));
      if (s.status === "done" && s.videoUrl) {
        // CAS-claim: банкуем ТОЛЬКО если строка ещё rendering (защита от двойного банка при параллельном опросе)
        const { data: won } = await db.from("reel_variants").update({ status: "banking", updated_at: new Date().toISOString() })
          .eq("id", r.id).eq("status", "rendering").select("id").maybeSingle();
        if (!won) continue; // другой опрос уже забрал
        let catalogUrl: string | null = null;
        try {
          const g = await internalFetch(`${req.nextUrl.origin}/api/factory/gen-save`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_url: s.videoUrl, article, niche, hook: String(r.hook || ""), route: "reel_recompose", engine: "remotion" }),
            signal: AbortSignal.timeout(40000),
          }).then((x) => x.json()).catch(() => ({}));
          catalogUrl = g?.url || null;
          if (!catalogUrl) console.error(`[reel-recompose] gen-save без url (recipe ${recipeId} variant ${r.variant_idx}) — баним raw Remotion-URL (видео годное, но не в каталоге)`);
        } catch (e) { console.error(`[reel-recompose] gen-save упал (recipe ${recipeId} variant ${r.variant_idx}):`, String((e as Error)?.message || e).slice(0, 120)); }
        // статус done всегда (видео готово); video_url = каталог или raw Remotion (не теряем оплаченный рендер)
        await db.from("reel_variants").update({ status: "done", video_url: catalogUrl || s.videoUrl, updated_at: new Date().toISOString() }).eq("id", r.id);
        r.status = "done"; r.video_url = catalogUrl || s.videoUrl;
      } else if (s.status === "error" && s.retryable !== true) {
        await db.from("reel_variants").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", r.id);
        r.status = "error";
      }
    }
    const done = variants.filter((r) => r.status === "done").length;
    return NextResponse.json({ ok: true, recipe_id: recipeId, done, total: variants.length, variants });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "чтение пересборки рила упало: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
