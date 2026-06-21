import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { claimNextJob, saveJob, MAX_STEP_ATTEMPTS, MAX_POLLS, type FactoryJob } from "@/lib/factory/jobs";
import { extractFrames, overlayPngBase64, buildCarouselSlides } from "@/lib/factory/serverMedia";
import { shotstackSubmit, shotstackStatus, shotstackReady } from "@/lib/factory/shotstack";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const POLL_WAIT_MS = 12_000; // пауза между проверками статуса рендера (паузим в шаге, в пределах 60с)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jpost(origin: string, path: string, body: unknown, ms = 55000): Promise<any> { // LLM-шаги (produce/scenario/video-fal) зовут Claude — даём почти весь бюджет дочернего роута (maxDuration 60)
  const r = await fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  return r.json().catch(() => ({}));
}

// ОДИН шаг джобы: переиспускаем существующие роуты завода (auth их не гейтит — см. proxy.ts).
// Полный конвейер (Стадия 2): produce → scenario → submit → poll → otk(кадры+критик+ретрай) → overlay(текст+пересуд) → save.
// Серверные аналоги браузерных кусков: serverMedia.extractFrames (fal extract-frame) + overlayPngBase64 (sharp SVG→PNG).
async function runStep(db: SupabaseClient, origin: string, job: FactoryJob): Promise<void> {
  const st = job.state || {};
  const art = job.article || "";
  const hook = job.hook || "";

  if (job.step === "produce") {
    // Проверяем наличие реального материала ДО produce — чтобы маршрутизатор получил точные данные.
    // Кешируем realImg в state → submit-шаг переиспользует без повторного запроса к диску.
    let realImg = st.realImg || "";
    let hasFootage = false;
    if (!realImg && art) {
      try {
        const ds = await jpost(origin, "/api/factory/disk-source", { product: st.product_name || "", article: art }, 20000);
        const u = ds?.found && Array.isArray(ds.images) && ds.images[0]?.url;
        if (u) realImg = u.startsWith("http") ? u : origin + u;
        hasFootage = ds?.found && Array.isArray(ds.videos) && ds.videos.length > 0;
      } catch { /* нет реального фото — produce решит сам */ }
    }
    // Плейбук ниши для produce: render_role говорит «нельзя AI целым роликом» → продюсер не выберет ai_generation_ref
    let producePlaybook: unknown = null;
    try {
      const dbPr = getSupabaseAdmin();
      if (dbPr && art) {
        const { nicheFromArticle: nfa } = await import("@/lib/factory/rubric");
        const rn = nfa(art, st.product_name || "");
        if (rn) { const { data: pb } = await dbPr.from("niche_playbooks").select("playbook").eq("niche", rn).maybeSingle(); if (pb?.playbook) producePlaybook = pb.playbook; }
      }
    } catch { /* niche_playbooks не применена */ }
    const pr = await jpost(origin, "/api/factory/produce", { idea: hook, product: art, available: { photos: !!realImg, footage: hasFootage }, playbook: producePlaybook || undefined });
    if (!pr || !pr.decision) throw new Error("produce без decision: " + (pr?.error || pr?.detail || "?")); // не молчим — иначе джоба «успешна» на сбое
    const engine = ["kling", "pika", "seedance"].includes(pr?.decision?.engine) ? pr.decision.engine : "seedance";
    const route = pr?.decision?.route || "ai_generation_ref";
    // реальный хребет (slideshow/repurpose_cut) → Shotstack-сборка; AI-пути → сценарий+fal
    const ASSEMBLY_ROUTES = ["repurpose_cut", "slideshow"];
    const nextStep = ASSEMBLY_ROUTES.includes(route) ? "assemble" : "scenario";
    await saveJob(db, job.id, { step: nextStep, status: "running", attempts: 0, lease_until: null, state: { ...st, route, engine, realImg: realImg || null } });
    return;
  }

  if (job.step === "scenario") {
    const hookBoost = !!st.hookBoost; // второй проход после слабого хука
    // Загружаем скомпилированный плейбук ниши из кеша (niche_playbooks) — без браузерного localStorage.
    // Даёт сценаристу winning_formats/hooks/anti_patterns из реального Virlo-анализа.
    let cachedPlaybook: unknown = null;
    if (!hookBoost) {
      try {
        const { nicheFromArticle: nfa } = await import("@/lib/factory/rubric");
        const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
        const dbP = getSupabaseAdmin();
        const rn = nfa(art, st.product_name || "");
        if (dbP && rn) {
          const { data: pb } = await dbP.from("niche_playbooks").select("playbook").eq("niche", rn).maybeSingle();
          if (pb?.playbook) cachedPlaybook = pb.playbook;
        }
      } catch { /* niche_playbooks не применена → без плейбука */ }
    }
    const sr = await jpost(origin, "/api/factory/scenario", { article: art, hook, hook_boost: hookBoost, playbook: cachedPlaybook || undefined });
    const scenario = sr?.scenario || null;

    // Storyboard pre-filter: дешёвый текстовый ОТК ДО дорогого рендера (только первый раз).
    // Если хук слабый — перегоняем сценарий с hook_boost (уже проверенный флаг scenario-роута).
    if (scenario && !hookBoost) {
      const sv = await jpost(origin, "/api/factory/video-critic",
        { storyboard: true, hook, scenario, mode: job.mode, article: art, product_name: st.product_name }, 20000).catch(() => null);
      // В text-режиме native/brand фиксированы на 3 → минимальный score≈5 даже при хуке=1.
      // Смотрим напрямую на ось A (hook): < 3 из 5 = витрина/скучно → boostим.
      const hookAxisWeak = sv && typeof sv.axes?.hook === "number" && sv.axes.hook < 3;
      if (hookAxisWeak) {
        await saveJob(db, job.id, { step: "scenario", status: "running", attempts: 0, lease_until: null, state: { ...st, hookBoost: true, storyboardScore: sv.score } });
        return;
      }
    }

    await saveJob(db, job.id, { step: "submit", status: "running", attempts: 0, lease_until: null, state: { ...st, scenario, product_name: sr?.product || st.product_name } });
    return;
  }

  if (job.step === "submit") {
    if (st.task_id) { // рендер уже запущен (ретрай после сбоя сохранения) — НЕ платим за второй fal-таск
      await saveJob(db, job.id, { step: "poll", status: "polling", attempts: 0, lease_until: null, state: { ...st, pollCount: st.pollCount || 0 } });
      return;
    }
    // ЖЁСТКИЙ лимит платных рендеров на джобу: считаем ДО оплаты — потеря task_id при сбое не удвоит списание fal.
    const renderCount = (st.renderCount || 0) + 1;
    if (renderCount > 3) throw new Error("превышен лимит рендеров (3) — стоп для защиты бюджета");
    await saveJob(db, job.id, { state: { ...st, renderCount } });
    let realImg = st.realImg || ""; // реальное фото со съёмки: фотореал > generic; на ОТК-ретрае переиспользуем без повторного disk-source
    if (!realImg) {
      try {
        const ds = await jpost(origin, "/api/factory/disk-source", { product: st.product_name || "", article: art });
        const u = ds?.found && Array.isArray(ds.images) && ds.images[0]?.url;
        if (u) realImg = u.startsWith("http") ? u : origin + u;
      } catch { /* нет реального фото — рендерим без референса */ }
    }
    // st.prompt — улучшенный промпт после провала ОТК (ретрай-петля)
    // shot_visual — что должно быть в первом кадре (из сценария), для выравнивания промпта видео со сценарием
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shot_visual = ((st.scenario?.shots as any[])?.[0]?.visual || "").toString().slice(0, 200) || undefined;
    const d = await jpost(origin, "/api/factory/video-fal", { sku_art: art, image_url: realImg || undefined, model: st.engine || "seedance", brief: hook, prompt: st.prompt || undefined, product_name: st.product_name, shot_visual });
    if (!d?.task_id) throw new Error("video-fal не запустился: " + (d?.detail || d?.error || "?"));
    await saveJob(db, job.id, { step: "poll", status: "polling", attempts: 0, lease_until: null, state: { ...st, renderCount, realImg, task_id: d.task_id, prompt_used: d.prompt_used || st.prompt || "", pollCount: 0 } });
    return;
  }

  if (job.step === "poll") {
    await sleep(POLL_WAIT_MS); // пейсим опрос; следующий тик возьмёт джобу снова
    const pollCount = (st.pollCount || 0) + 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let s: any = {};
    try { s = await fetch(`${origin}/api/factory/video-fal-status/${st.task_id}`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json()); } catch { s = {}; }
    if (s?.status === "done" && s.video_url) {
      await saveJob(db, job.id, { step: "otk", status: "running", attempts: 0, lease_until: null, state: { ...st, video_url: s.video_url, pollCount } });
    } else if (pollCount >= MAX_POLLS) {
      throw new Error("рендер не успел/недоступен (timeout): " + (s?.error || s?.status || "?"));
    } else {
      // ещё рендерится ИЛИ транзиентная ошибка статуса fal — НЕ валим джобу, опрашиваем до MAX_POLLS (attempts=0)
      await saveJob(db, job.id, { status: "polling", attempts: 0, lease_until: null, state: { ...st, pollCount, lastStatus: s?.status || s?.error || "pending" } });
    }
    return;
  }

  if (job.step === "otk") {
    const frames = await extractFrames(st.video_url);
    if (!frames.length) { // кадры не извлеклись → не блокируем, идём в оверлей без ОТК
      await saveJob(db, job.id, { step: "overlay", status: "running", attempts: 0, lease_until: null, state: { ...st, otkSkipped: true } });
      return;
    }
    const v = await jpost(origin, "/api/factory/video-critic", { frames, hook, scenario: st.scenario, mode: job.mode, article: art, product_name: st.product_name });
    const score = typeof v?.score === "number" ? v.score : null;
    if (score == null) throw new Error("ОТК не вернул балл (транзиент) — пере-проверка"); // не проталкиваем провал в overlay, а пере-критикуем через step-retry
    const otkAttempt = st.otkAttempt || 0;
    const prevBest = typeof st.bestScore === "number" ? st.bestScore : -1;
    const best = score > prevBest ? { score, url: st.video_url } : { score: prevBest, url: st.bestUrl || st.video_url };
    if (score < 7 && otkAttempt < 2) {
      // провал ОТК → улучшаем промпт под дефекты и перерендериваем (рендеры ограничены renderCount≤3)
      let prompt = st.prompt;
      try { const imp = await jpost(origin, "/api/factory/improve-prompt", { original: st.prompt_used || "", defects: v?.issues || [], fixes: v?.fixes || [], route: st.route, engine: st.engine || "seedance", context: hook + " · " + art }); if (imp?.prompt) prompt = imp.prompt; } catch { /* improve опционален — не валим джобу, рендерим с прежним промптом */ }
      await saveJob(db, job.id, { step: "submit", status: "running", attempts: 0, lease_until: null, state: { ...st, prompt, task_id: null, pollCount: 0, otkAttempt: otkAttempt + 1, bestScore: best.score, bestUrl: best.url } });
    } else {
      await saveJob(db, job.id, { step: "overlay", status: "running", attempts: 0, lease_until: null, state: { ...st, video_url: best.url, critScore: best.score >= 0 ? best.score : score, critAxes: v?.axes || null } });
    }
    return;
  }

  if (job.step === "overlay") {
    let finalUrl = st.video_url;
    let critScore = typeof st.critScore === "number" ? st.critScore : null;
    let overlaid = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subs = ((st.scenario?.shots || []) as any[]).map((x) => (x.onscreen || x.voiceover || "").trim()).filter(Boolean).slice(0, 4) as string[];
      const png = await overlayPngBase64(hook, subs);
      if (png) {
        const up = await jpost(origin, "/api/factory/media-store", { images: [png], prefix: "overlay", format: "png" });
        const overlayUrl = up?.urls?.[0];
        if (overlayUrl) {
          const cmp = await jpost(origin, "/api/factory/overlay", { video_url: st.video_url, overlay_url: overlayUrl, duration: 5 });
          if (cmp?.video_url) {
            finalUrl = cmp.video_url; overlaid = true;
            // v2: пересуд оверленного (хук-текст теперь в кадре) — балл не топим ниже базового
            try {
              const fr = await extractFrames(finalUrl);
              if (fr.length) { const vo = await jpost(origin, "/api/factory/video-critic", { frames: fr, hook, scenario: st.scenario, mode: job.mode, article: art, product_name: st.product_name }); if (typeof vo?.score === "number") critScore = Math.max(critScore ?? 0, vo.score); }
            } catch { /* пересуд опционален */ }
          }
        }
      }
    } catch { /* оверлей опционален — сохраняем видео без текста */ }
    await saveJob(db, job.id, { step: "save", status: "running", attempts: 0, lease_until: null, state: { ...st, video_url: finalUrl, overlay: overlaid, critScore } });
    return;
  }

  // ── Factory v2: реальный хребет (slideshow/repurpose_cut) → Shotstack-монтаж ──────────────────

  if (job.step === "assemble") {
    if (!shotstackReady()) {
      // SHOTSTACK_API_KEY не задан.
      // slideshow (реальное фото) → сервер-карусель (sharp, без Shotstack, без AI-слопа).
      // repurpose_cut (видео-монтаж без Shotstack) → откат на AI-путь.
      if (st.route === "slideshow") {
        let imgUrl = st.realImg || "";
        if (!imgUrl) {
          try {
            const ds = await jpost(origin, "/api/factory/disk-source", { product: st.product_name || "", article: art }, 20000);
            if (ds?.found && Array.isArray(ds.images) && ds.images[0]?.url) {
              const u = ds.images[0].url;
              imgUrl = u.startsWith("http") ? u : origin + u;
            }
          } catch { /* нет фото — упадём в fallback ниже */ }
        }
        if (!imgUrl) {
          // нет реального фото — всё-таки откатываемся на AI (лучше, чем пустой результат)
          await saveJob(db, job.id, { step: "scenario", status: "running", attempts: 0, lease_until: null, state: { ...st, fallback: "no_image_for_carousel" } });
          return;
        }
        const texts = [hook, st.product_name ? "Ищи на WB: " + art : art].filter(Boolean);
        const slides = await buildCarouselSlides(imgUrl, texts);
        if (!slides.length) {
          await saveJob(db, job.id, { step: "scenario", status: "running", attempts: 0, lease_until: null, state: { ...st, fallback: "carousel_failed" } });
          return;
        }
        const g = await jpost(origin, "/api/factory/gen-save", { slides, article: art, product_name: st.product_name, hook, route: "slideshow", engine: "server-carousel", otk: null }, 90000);
        await saveJob(db, job.id, { step: "done", status: "done", lease_until: null, result: { catalog_url: g?.url || null, slides: slides.length } });
        return;
      }
      await saveJob(db, job.id, { step: "scenario", status: "running", attempts: 0, lease_until: null, state: { ...st, fallback: "shotstack_missing" } });
      return;
    }
    const a = await jpost(origin, "/api/factory/assemble", { article: art, hook, mode: job.mode, product_name: st.product_name }, 30000);
    if (!a?.edit_json || !a.block_ids?.length) {
      // нет реальных ассетов в библиотеке → откат на AI-путь
      await saveJob(db, job.id, { step: "scenario", status: "running", attempts: 0, lease_until: null, state: { ...st, fallback: a?.error || "no_assets" } });
      return;
    }
    await saveJob(db, job.id, { step: "compose-submit", status: "running", attempts: 0, lease_until: null, state: { ...st, edit_json: a.edit_json, block_ids: a.block_ids, beat_times: a.beat_times || [], composeCount: 0 } });
    return;
  }

  if (job.step === "compose-submit") {
    if (st.render_id) {
      // рендер уже запущен (ретрай после сбоя сохранения) — НЕ платим за второй Shotstack-рендер
      await saveJob(db, job.id, { step: "compose-poll", status: "polling", attempts: 0, lease_until: null, state: { ...st, pollCount: st.pollCount || 0 } });
      return;
    }
    const composeCount = (st.composeCount || 0) + 1;
    if (composeCount > 3) throw new Error("превышен лимит Shotstack-рендеров (3) — стоп для защиты бюджета");
    await saveJob(db, job.id, { state: { ...st, composeCount } }); // сохраняем до вызова API — не удвоим счётчик при сбое
    const render_id = await shotstackSubmit(st.edit_json as Record<string, unknown>);
    if (!render_id) throw new Error("shotstackSubmit вернул null — проверь SHOTSTACK_API_KEY и схему edit_json");
    await saveJob(db, job.id, { step: "compose-poll", status: "polling", attempts: 0, lease_until: null, state: { ...st, composeCount, render_id, pollCount: 0 } });
    return;
  }

  if (job.step === "compose-poll") {
    await sleep(POLL_WAIT_MS);
    const pollCount = (st.pollCount || 0) + 1;
    const s = await shotstackStatus(st.render_id as string);
    if (s.status === "done" && s.videoUrl) {
      await saveJob(db, job.id, { step: "otk", status: "running", attempts: 0, lease_until: null, state: { ...st, video_url: s.videoUrl, pollCount } });
    } else if (s.status === "error") {
      throw new Error("Shotstack error: " + (s.error || "unknown"));
    } else if (pollCount >= MAX_POLLS) {
      throw new Error("Shotstack render timeout (" + pollCount + " тиков)");
    } else {
      await saveJob(db, job.id, { status: "polling", attempts: 0, lease_until: null, state: { ...st, pollCount } });
    }
    return;
  }

  // ────────────────────────────────────────────────────────────────────────────────────────────────

  if (job.step === "save") {
    const g = await jpost(origin, "/api/factory/gen-save", { video_url: st.video_url, article: art, product_name: st.product_name, hook, route: st.route, engine: st.engine, otk: st.critScore ?? null }, 120000);
    // Factory v2: сохраняем рецепт сборки (edit_json + block_ids) для воспроизводимости и петли winners
    if (st.edit_json) {
      try {
        await db.from("factory_assemblies").insert({
          article: art || null, hook, mode: job.mode,
          edit_json: st.edit_json, block_ids: st.block_ids || [],
          beat_times: st.beat_times || [], render_id: st.render_id || null,
          output_url: g?.url || null, otk_score: st.critScore ?? null,
        });
      } catch { /* factory_assemblies может ещё не быть (миграция 20260621 не применена) */ }
    }
    await saveJob(db, job.id, { step: "done", status: "done", lease_until: null, result: { catalog_url: g?.url || null } });
    return;
  }
}

export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const origin = req.nextUrl.origin;

  const job = await claimNextJob(db);
  if (!job) return NextResponse.json({ idle: true }); // нет работы → цепочка останавливается

  after(async () => {
    try {
      await runStep(db, origin, job);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
      const attempts = (job.attempts || 0) + 1;
      if (attempts >= MAX_STEP_ATTEMPTS) await saveJob(db, job.id, { status: "failed", error: msg, lease_until: null });
      else await saveJob(db, job.id, { status: "running", attempts, error: msg, lease_until: null }); // ретрай того же шага
    }
    // продолжить цепочку: следующий тик возьмёт следующий шаг/джобу (или вернёт idle и остановится)
    try { await fetch(`${origin}/api/factory/jobs/tick`, { method: "POST", signal: AbortSignal.timeout(20000) }); } catch { /* цепочка прервётся — воскресит list-резурекция/cron-бэкстоп */ }
  });

  return NextResponse.json({ claimed: job.id, step: job.step });
}
