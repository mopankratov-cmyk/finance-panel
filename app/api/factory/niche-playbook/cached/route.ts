import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nicheFromArticle } from "@/lib/factory/rubric";
import { normalizeTargetPlatform, selectReelsBrain } from "@/lib/factory/reelsBrainPlaybook";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Вернуть КЭШИРОВАННЫЙ плейбук ниши из niche_playbooks по товару (сервер сам считает нишу через rubric).
// Кокпит зовёт это ПЕРЕД запуском Orbit: если ниша уже разобрана (раз в неделю обновляет corpus-cron),
// берём плейбук из памяти — без ожидания анализа 15-20 мин. GET ?article=HT-80-35&product_name=Ветровка
export async function GET(req: NextRequest) {
  try {
  const sp = req.nextUrl.searchParams;
  const article = (sp.get("article") || "").trim();
  const productName = (sp.get("product_name") || "").trim();
  const targetPlatform = normalizeTargetPlatform(sp.get("target_platform") || sp.get("platform"));
  const niche = nicheFromArticle(article, productName);

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ niche, playbook: null, note: "Supabase не настроен" });

  try {
    const { data, error } = await db
      .from("niche_playbooks")
      .select("playbook,updated_at")
      .eq("niche", niche)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error?.code === "42P01") return NextResponse.json({ niche, playbook: null, note: "niche_playbooks не применена" });
    if (error) return NextResponse.json({ niche, playbook: null, note: error.message });

    const row = (data as { playbook: unknown; updated_at: string | null }[] | null)?.[0];
    if (!row || !row.playbook) return NextResponse.json({ niche, playbook: null });

    const updatedAt = row.updated_at || "";
    // stale = старше 7 дней (corpus-cron обновляет еженедельно; на фронте просто сигнал, не блокирует)
    const stale = updatedAt ? (Date.now() - new Date(updatedAt).getTime() > 7 * 24 * 60 * 60 * 1000) : true;
    const selectedBrain = selectReelsBrain(row.playbook, targetPlatform);
    return NextResponse.json({
      niche,
      playbook: row.playbook,
      updated_at: updatedAt,
      stale,
      target_platform: targetPlatform,
      reels_brain: {
        selected_platform: selectedBrain.requested_platform,
        platform_brain: selectedBrain.brain,
        meta_brain: selectedBrain.meta_brain,
        cross_platform_patterns: selectedBrain.cross_platform_patterns,
      },
    });
  } catch (e) {
    return NextResponse.json({ niche, playbook: null, note: String(e).slice(0, 120) });
  }
  } catch (e) {
    return NextResponse.json({
      niche: "default",
      playbook: null,
      note: "niche-playbook/cached crash: " + String((e as Error)?.message || e).slice(0, 160),
    });
  }
}
