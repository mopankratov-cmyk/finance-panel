import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { deleteProductTwin, getLatestProductTwinByArticle, getProductTwinById } from "@/lib/factory/productTwinStore";
import { deleteYandexProductTwinFile } from "@/lib/factory/yandexArchive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// Полное удаление твина (строки БД + файлы архива). Только с явным confirm.
// Задумано для твинов, проваливших identity-аудит: заблокированы гейтом и не нужны.

const CONFIRM = "delete-product-twin";

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    if (body.confirm !== CONFIRM) return NextResponse.json({ ok: false, error: `нужен confirm: ${CONFIRM}` }, { status: 400 });

    let twinId = String(body.twin_id || "").trim();
    const article = String(body.article || "").trim();
    if (!twinId && article) {
      const twin = await getLatestProductTwinByArticle(db, article);
      if (!twin) return NextResponse.json({ ok: false, error: `twin для ${article} не найден` }, { status: 404 });
      twinId = twin.twinId;
    }
    if (!twinId) return NextResponse.json({ ok: false, error: "нужен twin_id или article" }, { status: 400 });

    // Страховка: без force удаляем только твины с identity_verdict=fail.
    const twin = await getProductTwinById(db, twinId);
    if (!twin) return NextResponse.json({ ok: false, error: `twin ${twinId} не найден` }, { status: 404 });
    if (twin.identityVerdict?.verdict !== "fail" && body.force !== true) {
      return NextResponse.json({ ok: false, error: `twin ${twinId} не помечен fail (identity_verdict=${twin.identityVerdict?.verdict || "нет"}); для удаления передай force:true` }, { status: 409 });
    }

    const result = await deleteProductTwin(db, { twinId });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, deleted_rows: result.deletedRows }, { status: 500 });

    const diskResults: Array<{ path: string; ok: boolean; error?: string }> = [];
    if (body.delete_disk_files !== false) {
      for (const path of result.yandexPaths) {
        const res = await deleteYandexProductTwinFile(path);
        diskResults.push({ path, ok: res.ok, error: res.error });
      }
    }

    return NextResponse.json({
      ok: true,
      twin_id: twinId,
      deleted_rows: result.deletedRows,
      disk_files_total: result.yandexPaths.length,
      disk_files_deleted: diskResults.filter((r) => r.ok).length,
      disk_failures: diskResults.filter((r) => !r.ok).map((r) => ({ path: r.path.slice(-80), error: r.error })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "product-twin delete crash: " + String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
  }
}
