import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Быстрая проверка состояния системы: какие таблицы/ключи применены.
// GET /api/factory/status → { tables, keys, pending }
// Не требует авторизации (только читает структуру, не данные).

async function tableExists(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, name: string): Promise<boolean> {
  try {
    const { error } = await db.from(name).select("id").limit(0);
    return !error || error.code !== "42P01"; // 42P01 = relation does not exist
  } catch { return false; }
}

export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const [
    hasViral,
    hasOrbits,
    hasMonitors,
    hasHooks,
    hasAssemblies,
    hasWinners,
    hasPlaybooks,
  ] = await Promise.all([
    tableExists(db, "viral_videos"),
    tableExists(db, "orbit_searches"),
    tableExists(db, "niche_monitors"),
    tableExists(db, "viral_hooks"),
    tableExists(db, "factory_assemblies"),
    tableExists(db, "content_assets"), // winners columns added in 20260622
    tableExists(db, "niche_playbooks"),
  ]);

  // Проверяем unique idx на viral_hooks (нужен для upsert, добавлен в 20260624)
  let hooksUniqueIdx = false;
  if (hasHooks) {
    try {
      // Пробуем upsert с onConflict — если уникального индекса нет, это упадёт
      const { error } = await db.from("viral_hooks").upsert(
        { niche: "__check__", hook_text: "__idx_check__", viability_score: 0 },
        { onConflict: "niche,hook_text", ignoreDuplicates: true }
      );
      hooksUniqueIdx = !error;
      // Удалить тестовую строку (если вставилась)
      if (!error) await db.from("viral_hooks").delete().eq("hook_text", "__idx_check__");
    } catch { hooksUniqueIdx = false; }
  }

  // Счётчики контента
  let hookCount = 0;
  let videoCount = 0;
  let orbitCount = 0;
  let playbookCount = 0;
  let orbitsWithoutPlaybook = 0;
  if (hasHooks) {
    try { const { count } = await db.from("viral_hooks").select("id", { count: "exact", head: true }); hookCount = count ?? 0; } catch { /* */ }
  }
  if (hasViral) {
    try { const { count } = await db.from("viral_videos").select("id", { count: "exact", head: true }); videoCount = count ?? 0; } catch { /* */ }
  }
  if (hasOrbits) {
    try { const { count } = await db.from("orbit_searches").select("job_id", { count: "exact", head: true }); orbitCount = count ?? 0; } catch { /* */ }
  }
  if (hasPlaybooks && hasOrbits) {
    try {
      const { data: orbitNiches } = await db.from("orbit_searches").select("niche").limit(20);
      const { data: pbNiches } = await db.from("niche_playbooks").select("niche").limit(20);
      playbookCount = (pbNiches ?? []).length;
      const have = new Set((pbNiches ?? []).map((r: { niche: string }) => r.niche));
      const need = [...new Set((orbitNiches ?? []).map((r: { niche: string }) => r.niche))].filter((n) => n && !have.has(n));
      orbitsWithoutPlaybook = need.length;
    } catch { /* */ }
  }

  const tables = {
    viral_videos: hasViral,
    orbit_searches: hasOrbits,
    niche_monitors: hasMonitors,
    viral_hooks: hasHooks,
    viral_hooks_unique_idx: hooksUniqueIdx,
    factory_assemblies: hasAssemblies,
    content_assets: hasWinners,
    niche_playbooks: hasPlaybooks,
  };

  const keys = {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    virlo: !!process.env.VIRLO_API_KEY,
    creatify: !!(process.env.CREATIFY_API_ID && process.env.CREATIFY_API_KEY),
    shotstack: !!process.env.SHOTSTACK_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    fal: !!process.env.FAL_KEY,
  };

  // Что нужно сделать
  const pending: string[] = [];
  if (!hasViral || !hasOrbits || !hasMonitors || !hasHooks) pending.push("Применить 20260620_viral_corpus.sql в Supabase SQL Editor");
  if (!hooksUniqueIdx && hasHooks) pending.push("Применить 20260624_viral_hooks_unique.sql (unique idx для upsert хуков)");
  if (hasHooks && hookCount < 5) pending.push("Применить 20260625_viral_hooks_seed.sql (37 проверенных хуков)");
  if (!hasAssemblies) pending.push("Применить 20260621_factory_v2_assembly.sql (Shotstack)");
  if (!hasPlaybooks) pending.push("Применить 20260623_niche_playbooks.sql (кеш плейбуков)");
  if (orbitCount === 0 && hasOrbits) pending.push("Нажать «🔄 Синк орбит» в кокпите чтобы скачать ~350 видео из 4 орбит");
  if (orbitsWithoutPlaybook > 0) pending.push(`Нажать «🧠 Плейбуки» в кокпите — ${orbitsWithoutPlaybook} ниш без плейбука`);
  if (!keys.shotstack) pending.push("Добавить SHOTSTACK_API_KEY в Vercel (v2 монтаж реального видео)");
  if (keys.shotstack && !process.env.SHOTSTACK_FONT_URL) pending.push("Добавить SHOTSTACK_FONT_URL в Vercel (Cyrillic-TTF URL, иначе RU текст = квадраты)");
  if (keys.shotstack && !process.env.SHOTSTACK_FONT_FAMILY) pending.push("Добавить SHOTSTACK_FONT_FAMILY в Vercel (имя шрифта из TTF, напр. «Roboto»)");
  if (!keys.gemini) pending.push("Добавить GEMINI_API_KEY в Vercel (U4 Nano Banana)");

  return NextResponse.json({
    ok: true,
    tables,
    keys,
    counts: { viral_videos: videoCount, viral_hooks: hookCount, orbit_searches: orbitCount, niche_playbooks: playbookCount },
    pending,
    ready: pending.length === 0,
  });
}
