import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { getLatestProductTwinByArticle, getProductTwinById, setProductTwinIdentityVerdict } from "@/lib/factory/productTwinStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Identity-вердикт твина: результат сверки «оригинал съёмки vs твин».
// fail → getBestProductTwinAsset больше не отдаёт этот твин, b-roll падает на реальные фото.
// GET ?article=|twin_id= — текущий вердикт; POST { twin_id|article, verdict, reasons[] } — записать.

const VERDICTS = new Set(["pass", "warn", "fail"]);

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const sp = req.nextUrl.searchParams;
    const twinId = String(sp.get("twin_id") || "").trim();
    const article = String(sp.get("article") || "").trim();
    const twin = twinId ? await getProductTwinById(db, twinId) : article ? await getLatestProductTwinByArticle(db, article) : null;
    if (!twin) return NextResponse.json({ ok: false, error: "twin не найден (нужен twin_id или article)" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      twin_id: twin.twinId,
      article: twin.article,
      quality_score: twin.qualityScore,
      identity_verdict: twin.identityVerdict || null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "identity-verdict GET crash: " + String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const verdict = String(body.verdict || "").trim() as "pass" | "warn" | "fail";
    if (!VERDICTS.has(verdict)) return NextResponse.json({ ok: false, error: "verdict должен быть pass|warn|fail" }, { status: 400 });
    const reasons = Array.isArray(body.reasons) ? body.reasons.map((r: unknown) => String(r || "").trim()).filter(Boolean) : [];
    if (verdict !== "pass" && !reasons.length) return NextResponse.json({ ok: false, error: "для warn/fail нужны reasons" }, { status: 400 });

    let twinId = String(body.twin_id || "").trim();
    const article = String(body.article || "").trim();
    if (!twinId && article) {
      const twin = await getLatestProductTwinByArticle(db, article);
      if (!twin) return NextResponse.json({ ok: false, error: `twin для ${article} не найден` }, { status: 404 });
      twinId = twin.twinId;
    }
    if (!twinId) return NextResponse.json({ ok: false, error: "нужен twin_id или article" }, { status: 400 });

    const result = await setProductTwinIdentityVerdict(db, { twinId, verdict, reasons, source: String(body.source || "manual_audit").slice(0, 60) });
    if (!result.ok && !result.updated) return NextResponse.json({ ok: false, error: result.error || "не удалось записать вердикт" }, { status: 500 });
    return NextResponse.json({ ok: result.ok, twin_id: twinId, verdict, updated_rows: result.updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "identity-verdict POST crash: " + String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
  }
}
