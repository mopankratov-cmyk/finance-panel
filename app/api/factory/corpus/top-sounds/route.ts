import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

// Агрегирует звуки из orbit_searches.sounds JSON-поля.
// Virlo сохраняет их при sync-orbit: { id, title, usage_count, avg_views, is_commerce_safe }.
// GET ?niche=cosmetics&limit=10&safe_only=true

export async function GET(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ sounds: [], total: 0, warning: "Supabase не настроен — корпус звуков временно пустой" });

  const sp = req.nextUrl.searchParams;
  const niche = sp.get("niche") || "";
  const limit = Math.min(50, Math.max(1, Number(sp.get("limit") || 10)));
  const safeOnly = sp.get("safe_only") !== "false";

  try {
    // Берём все записи orbit_searches, у которых есть sounds (не null)
    const q = db.from("orbit_searches").select("niche,sounds").not("sounds", "is", null);
    if (niche) q.eq("niche", niche);
    const { data, error } = await q;
    if (error) {
      if (error.code === "42P01") return NextResponse.json({ sounds: [], total: 0, warning: "orbit_searches не применена" });
      return NextResponse.json({ sounds: [], total: 0, warning: error.message });
    }

    // Агрегируем звуки по id — суммируем avg_views, считаем встречаемость
    const map = new Map<string, { id: string; title: string; avg_views: number; usage_count: number; count: number; niches: Set<string>; is_commerce_safe: boolean }>();
    for (const row of (data || []) as { niche: string; sounds: unknown[] }[]) {
      const sounds = Array.isArray(row.sounds) ? row.sounds : [];
      for (const s of sounds as Record<string, unknown>[]) {
        const id = String(s.id || s.sound_id || "").trim();
        const title = String(s.title || s.sound_title || s.name || "").trim();
        if (!id || !title) continue;
        const isSafe = typeof s.is_commerce_safe === "boolean" ? s.is_commerce_safe : true;
        if (safeOnly && !isSafe) continue;
        const avgViews = Number(s.avg_views || s.average_views || 0);
        const usageCount = Number(s.usage_count || s.total_usage || 0);
        if (!map.has(id)) {
          map.set(id, { id, title, avg_views: avgViews, usage_count: usageCount, count: 1, niches: new Set([row.niche || "default"]), is_commerce_safe: isSafe });
        } else {
          const ex = map.get(id)!;
          ex.count++;
          ex.avg_views = Math.max(ex.avg_views, avgViews);
          ex.usage_count = Math.max(ex.usage_count, usageCount);
          ex.niches.add(row.niche || "default");
        }
      }
    }

    const sounds = Array.from(map.values())
      .map((s) => ({ ...s, niches: Array.from(s.niches) }))
      .sort((a, b) => b.avg_views - a.avg_views || b.usage_count - a.usage_count)
      .slice(0, limit);

    return NextResponse.json({ sounds, niche: niche || "all", total: map.size });
  } catch {
    return NextResponse.json({ sounds: [], total: 0, warning: "orbit_searches не применена" });
  }
  } catch (e) {
    return NextResponse.json({ sounds: [], total: 0, warning: "топ звуков упал: " + String((e as Error)?.message || e).slice(0, 160) });
  }
}
