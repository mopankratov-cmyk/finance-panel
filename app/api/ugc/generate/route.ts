import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { loadUgcProduct, UgcProductError } from "@/lib/ugc/product";
import { signUgcTask, submitUgcTask } from "@/lib/ugc/task";
import { normalizeUgcCreativeInput } from "@/lib/ugc/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const cabinetId = cabinetIdFromParam(typeof body.cabinetId === "string" ? body.cabinetId : null);
  const nmId = Number(body.nmId);
  if (!cabinetId || !Number.isSafeInteger(nmId) || nmId <= 0) return NextResponse.json({ ok: false, error: "Выберите кабинет и SKU" }, { status: 400 });
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ ok: false, error: "Нет доступа к кабинету" }, { status: 403 });
  const normalized = normalizeUgcCreativeInput(body);
  if (!normalized.ok) return NextResponse.json({ ok: false, error: normalized.error }, { status: 422 });
  try {
    const product = await loadUgcProduct(cabinetId, nmId);
    // Источник генерации — большая версия. С миниатюры 246×328 просить кадр
    // 1536×2048 значит просить модель дорисовать то, чего в исходнике нет.
    const imageUrl = product.photosBig[0] ?? product.photos[0];
    if (!imageUrl) return NextResponse.json({ ok: false, error: "У SKU нет исходного фото — генерация заблокирована" }, { status: 422 });
    const jobId = await submitUgcTask({ kind: normalized.value.kind, imageUrl, imagePrompt: normalized.value.imagePrompt, videoMotion: normalized.value.videoMotion });
    const taskToken = await signUgcTask({ provider: "higgsfield", jobId, kind: normalized.value.kind, cabinetId, nmId, article: product.article, avatarId: normalized.value.avatarId });
    return NextResponse.json({ ok: true, task: { token: taskToken, status: "queued", kind: normalized.value.kind, cabinetId, nmId, article: product.article, createdAt: new Date().toISOString() } });
  } catch (error) {
    const status = error instanceof UgcProductError ? error.status : 502;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не удалось поставить генерацию в очередь" }, { status });
  }
}
