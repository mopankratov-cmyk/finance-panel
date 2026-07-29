import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

export const dynamic = "force-dynamic";

export interface ReviewRow {
  id: string;
  nmId: number;
  article: string;
  productName: string | null;
  brandName: string | null;
  rating: number;
  text: string | null;
  pros: string | null;
  cons: string | null;
  photos: { mini?: string; full?: string }[];
  hasVideo: boolean;
  isAnswered: boolean;
  answerText: string | null;
  createdAt: string;
}

interface DbRow {
  id: string;
  nm_id: number;
  article: string;
  product_name: string | null;
  brand_name: string | null;
  rating: number;
  review_text: string | null;
  pros: string | null;
  cons: string | null;
  photos: { mini?: string; full?: string }[];
  has_video: boolean;
  is_answered: boolean;
  answer_text: string | null;
  created_at_wb: string;
}

function toRow(r: DbRow): ReviewRow {
  return {
    id: r.id, nmId: r.nm_id, article: r.article, productName: r.product_name, brandName: r.brand_name,
    rating: r.rating, text: r.review_text, pros: r.pros, cons: r.cons, photos: r.photos ?? [],
    hasVideo: r.has_video, isAnswered: r.is_answered, answerText: r.answer_text, createdAt: r.created_at_wb,
  };
}

export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });

  const sp = new URL(req.url).searchParams;
  const p_cabinet = cabinetIdFromParam(sp.get("cabinet"));
  if (!(await hasCabinetAccess(p_cabinet))) {
    return NextResponse.json({ ok: false, error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const allowedNmIds = await requestAllowedNmIds(p_cabinet);
  const scopedNmIds = allowedNmIds === null ? null : [...allowedNmIds];
  const ratingParam = (sp.get("rating") || "").split(",").map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 5);
  const answered = sp.get("answered") || "";
  const days = Math.max(1, Number(sp.get("days")) || 30);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 50));
  const offset = Math.max(0, Number(sp.get("offset")) || 0);

  try {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();

    let listQ = db.from("wb_feedbacks").select("*", { count: "exact" }).gte("created_at_wb", since).order("created_at_wb", { ascending: false }).range(offset, offset + limit - 1);
    if (p_cabinet) listQ = listQ.eq("cabinet_id", p_cabinet);
    if (scopedNmIds) listQ = listQ.in("nm_id", scopedNmIds.length ? scopedNmIds : [-1]);
    if (ratingParam.length) listQ = listQ.in("rating", ratingParam);
    if (answered === "answered") listQ = listQ.eq("is_answered", true);
    else if (answered === "unanswered") listQ = listQ.eq("is_answered", false);

    const ratingsPromise = loadAllSupabasePages<{ rating: number }>((from, to) => {
      let query = db
        .from("wb_feedbacks")
        .select("rating")
        .gte("created_at_wb", since30)
        .order("created_at_wb", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (p_cabinet) query = query.eq("cabinet_id", p_cabinet);
      if (scopedNmIds) query = query.in("nm_id", scopedNmIds.length ? scopedNmIds : [-1]);
      return query;
    }, { label: "Отзывы WB за 30 дней" });

    let unansweredQ = db.from("wb_feedbacks").select("id", { count: "exact", head: true }).eq("is_answered", false);
    if (p_cabinet) unansweredQ = unansweredQ.eq("cabinet_id", p_cabinet);
    if (scopedNmIds) unansweredQ = unansweredQ.in("nm_id", scopedNmIds.length ? scopedNmIds : [-1]);

    let criticalQ = db.from("wb_feedbacks").select("id", { count: "exact", head: true }).eq("is_answered", false).lte("rating", 2).gte("created_at_wb", since7);
    if (p_cabinet) criticalQ = criticalQ.eq("cabinet_id", p_cabinet);
    if (scopedNmIds) criticalQ = criticalQ.in("nm_id", scopedNmIds.length ? scopedNmIds : [-1]);

    const [listRes, ratingRows, unansweredRes, criticalRes] = await Promise.all([listQ, ratingsPromise, unansweredQ, criticalQ]);
    if (listRes.error) throw new Error(listRes.error.message);
    if (unansweredRes.error) throw new Error(unansweredRes.error.message);
    if (criticalRes.error) throw new Error(criticalRes.error.message);

    const ratings = ratingRows.map((row) => Number(row.rating));
    const avgRating30d = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : null;

    const rows = (listRes.data ?? []).map((r) => toRow(r as DbRow));
    const count = listRes.count ?? rows.length;

    let lastSyncError: string | null = null;
    if (rows.length === 0) {
      const { data } = await db.from("sync_log").select("error").eq("job", "feedbacks").eq("status", "error").order("started_at", { ascending: false }).limit(1).maybeSingle();
      lastSyncError = (data?.error as string) ?? null;
    }

    return NextResponse.json({
      ok: true,
      kpi: {
        avgRating30d,
        count30d: ratings.length,
        unansweredTotal: unansweredRes.count ?? 0,
        critical7d: criticalRes.count ?? 0,
      },
      rows,
      count,
      hasMore: offset + rows.length < count,
      warnings: [],
      lastSyncError,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
