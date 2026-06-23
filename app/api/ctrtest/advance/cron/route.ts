import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { setCardMedia } from "@/lib/wb/cardPhoto";
import { decideCtrStep, type CtrTestState, type CtrVariant } from "@/lib/ctrtest/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface TestRow {
  id: number; nm_id: number; status: string; enabled: boolean;
  interval_min: number; min_impr: number; cur_variant_id: number | null; cur_started_at: string | null;
}
interface VariantRow { id: number; test_id: number; image_url: string; views: number; clicks: number }

// GET — крон-оркестратор CTR-тестов (ежечасно, защита CRON_SECRET).
// Гоняет только running+enabled тесты. Глобальный стоп — env CTRTEST_OFF=1.
// ⚠️ ЗАМЕР показов/кликов по вариантам в v1 НЕ подключён (нужны почасовые статы тест-РК
// с привязкой к окну ротации) → totalImpr не растёт, финиш не наступит сам. Смена фото — за гейтом setCardMedia.
export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  if (process.env.CTRTEST_OFF === "1") return NextResponse.json({ ok: true, skipped: "CTRTEST_OFF" });

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const contentToken = process.env.WB_TOKEN_CONTENT || "";
  const nowMs = Date.now();

  const { data: tests } = await db
    .from("ctr_tests")
    .select("id, nm_id, status, enabled, interval_min, min_impr, cur_variant_id, cur_started_at")
    .eq("status", "running").eq("enabled", true);
  const rows = (tests ?? []) as TestRow[];
  if (!rows.length) return NextResponse.json({ ok: true, checked: 0, note: "нет running+enabled тестов" });

  const results: Record<string, unknown> = {};
  for (const t of rows) {
    const { data: vdata } = await db.from("ctr_variants").select("id, test_id, image_url, views, clicks").eq("test_id", t.id);
    const vrows = (vdata ?? []) as VariantRow[];
    const variants: CtrVariant[] = vrows.map((v) => ({ id: v.id, views: v.views, clicks: v.clicks }));
    const state: CtrTestState = {
      status: t.status, enabled: t.enabled, intervalMin: t.interval_min, minImpr: t.min_impr,
      curVariantId: t.cur_variant_id, curStartedAtMs: t.cur_started_at ? Date.parse(t.cur_started_at) : null,
    };
    const step = decideCtrStep(state, variants, nowMs);

    if (step.action === "rotate" && step.nextVariantId != null) {
      const chosen = vrows.find((v) => v.id === step.nextVariantId);
      const ordered = chosen ? [chosen.image_url, ...vrows.filter((v) => v.id !== chosen.id).map((v) => v.image_url)] : [];
      // placeholder media-list: реальный порядок медиа карточки собирается при живой валидации swap
      const swap = chosen ? await setCardMedia(contentToken, t.nm_id, ordered) : { ok: false, applied: false, error: "вариант не найден" };
      await db.from("ctr_tests").update({ cur_variant_id: step.nextVariantId, cur_started_at: new Date().toISOString() }).eq("id", t.id);
      await db.from("ctr_test_log").insert({ test_id: t.id, action: swap.applied ? "swap" : "rotate", variant_id: step.nextVariantId, detail: `${step.reason}${swap.applied ? "" : ` · swap: ${swap.error}`}` });
      results[t.id] = { action: "rotate", variant: step.nextVariantId, swapApplied: swap.applied, reason: step.reason };
    } else if (step.action === "finish") {
      await db.from("ctr_tests").update({ status: "done", winner_id: step.winnerId ?? null, finished_at: new Date().toISOString() }).eq("id", t.id);
      if (step.winnerId) await db.from("ctr_variants").update({ is_winner: true }).eq("id", step.winnerId);
      await db.from("ctr_test_log").insert({ test_id: t.id, action: "finish", variant_id: step.winnerId ?? null, detail: step.reason });
      results[t.id] = { action: "finish", winner: step.winnerId, reason: step.reason };
    } else {
      results[t.id] = { action: step.action, reason: step.reason };
    }
  }
  return NextResponse.json({ ok: true, checked: rows.length, results });
}
