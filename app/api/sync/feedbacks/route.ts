import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { cabinetProductScope, getActiveWbCabinets, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { fetchWbFeedbacksPage, WbFeedbacksScopeError } from "@/lib/wb/feedbacksApi";
import { allowsProduct } from "@/lib/wb/productScope";

export const maxDuration = 60;

const TAKE = 5000;
const MAX_PAGES_UNANSWERED = 4; // бэклог — тянем полностью (до ~20k/кабинет за прогон)
const MAX_PAGES_ANSWERED = 3; // история — ограничена ранним выходом по дате
const ANSWERED_WINDOW_DAYS = 35; // запас над 30-дневным окном KPI

// Наполняет wb_feedbacks. Не трогает lib/sync/cabinets.ts/SyncTarget (общий для
// orders/sales/stocks/adverts, поддерживает легаси ENV-режим с cabinet_id=null) —
// wb_feedbacks.cabinet_id NOT NULL, поэтому идём по getActiveWbCabinets() напрямую
// (тот же паттерн, что sync/commissions).
export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const cabs = await getActiveWbCabinets();
  if (!cabs.length) return NextResponse.json({ ok: true, rows: 0, cabinets: 0 });

  const cutoff = Date.now() - ANSWERED_WINDOW_DAYS * 86_400_000;
  let total = 0;
  const errors: string[] = [];
  const scopeGap: string[] = [];

  for (const cab of cabs) {
    const token = resolveWbToken(cab, "feedbacks");
    const productScope = cabinetProductScope(cab);
    const stamp = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    try {
      for (const isAnswered of [false, true]) {
        const maxPages = isAnswered ? MAX_PAGES_ANSWERED : MAX_PAGES_UNANSWERED;
        for (let page = 0; page < maxPages; page++) {
          const list = await fetchWbFeedbacksPage(token, isAnswered, page * TAKE, TAKE);
          if (!list.length) break;
          let hitCutoff = false;
          for (const f of list) {
            if (!f.id || !f.productDetails?.nmId) continue;
            if (!allowsProduct(productScope, f.productDetails.nmId, f.productDetails.brandName)) continue;
            const created = f.createdDate ?? null;
            if (isAnswered && created && new Date(created).getTime() < cutoff) { hitCutoff = true; continue; }
            rows.push({
              id: f.id,
              cabinet_id: cab.id,
              nm_id: f.productDetails.nmId,
              imt_id: f.productDetails.imtId ?? null,
              article: f.productDetails.supplierArticle ?? "",
              brand_name: f.productDetails.brandName ?? null,
              product_name: f.productDetails.productName ?? null,
              rating: f.productValuation,
              review_text: f.text ?? null,
              pros: f.pros ?? null,
              cons: f.cons ?? null,
              photos: (f.photoLinks ?? []).map((p) => ({ mini: p.miniSize, full: p.fullSize })),
              has_video: !!f.video,
              is_answered: isAnswered,
              answer_text: f.answer?.text ?? null,
              created_at_wb: created,
              synced_at: stamp,
            });
          }
          if (list.length < TAKE || (isAnswered && hitCutoff)) break;
        }
      }
    } catch (err) {
      if (err instanceof WbFeedbacksScopeError) { scopeGap.push(cab.name); continue; }
      errors.push(`${cab.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
      continue;
    }
    if (!rows.length) continue;
    const upsertErr = await chunkedUpsert("wb_feedbacks", rows, "id");
    if (upsertErr) { errors.push(`${cab.name}: ${upsertErr}`); continue; }
    total += rows.length;
  }

  if (scopeGap.length) {
    errors.push(`Нет доступа к отзывам у кабинетов: ${scopeGap.join(", ")}. Нужен WB-токен с категорией «Вопросы и Отзывы» (Настройки → Доступ к API).`);
  }
  const ok = errors.length === 0;
  await writeSyncLog("feedbacks", ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
  return NextResponse.json({ ok, rows: total, cabinets: cabs.length, errors });
}
