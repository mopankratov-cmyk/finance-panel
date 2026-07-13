import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadUgcProduct, UgcProductError } from "@/lib/ugc/product";
import { pollUgcTask, verifyUgcTask } from "@/lib/ugc/task";
import { confirmsUgcPublish, ugcPublishPhrase } from "@/lib/ugc/validation";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { checkCardHasVideo } from "@/lib/wb/cards";
import { saveCardMediaOrder } from "@/lib/wb/media";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const gate = await requireApiSession(["director"]);
  if (gate) return gate;
  const body = await request.json().catch(() => ({})) as { token?: unknown; confirmation?: unknown };
  const task = await verifyUgcTask(String(body.token ?? ""));
  if (!task) return NextResponse.json({ ok: false, error: "Задача генерации повреждена или истекла" }, { status: 400 });
  if (task.kind !== "image") return NextResponse.json({ ok: false, error: "Видео загружается в WB вручную после скачивания" }, { status: 422 });
  if (!(await hasCabinetAccess(task.cabinetId))) return NextResponse.json({ ok: false, error: "Нет доступа к кабинету задачи" }, { status: 403 });
  try {
    const product = await loadUgcProduct(task.cabinetId, task.nmId);
    const phrase = ugcPublishPhrase(product.article);
    if (!confirmsUgcPublish(product.article, body.confirmation)) return NextResponse.json({ ok: false, error: `Введите точную фразу: ${phrase}` }, { status: 422 });
    if (product.article !== task.article) return NextResponse.json({ ok: false, error: "Артикул SKU изменился после генерации — создайте задачу заново" }, { status: 409 });
    if (product.hasVideo) return NextResponse.json({ ok: false, error: "У карточки есть видео: безопасная автопубликация отключена, загрузите результат вручную" }, { status: 409 });

    const provider = await pollUgcTask(task);
    if (provider.status !== "done" || !provider.resultUrl) return NextResponse.json({ ok: false, error: provider.error || "Генерация ещё не завершена" }, { status: 409 });
    const resultUrl = new URL(provider.resultUrl);
    if (resultUrl.protocol !== "https:") return NextResponse.json({ ok: false, error: "Провайдер вернул небезопасную ссылку" }, { status: 502 });

    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен — публикация без аудита запрещена" }, { status: 503 });
    const cabinet = await getWbCabinet(task.cabinetId);
    if (!cabinet) return NextResponse.json({ ok: false, error: "Кабинет не найден" }, { status: 404 });
    const token = resolveWbToken(cabinet, "content");
    if (await checkCardHasVideo(token, task.nmId)) return NextResponse.json({ ok: false, error: "WB сообщил о видео в карточке — публикация заблокирована" }, { status: 409 });
    const photosAfter = [provider.resultUrl, ...product.photos.filter((url) => url !== provider.resultUrl)].slice(0, 30);
    const write = await saveCardMediaOrder(token, task.nmId, photosAfter);
    if (!write.ok) return NextResponse.json({ ok: false, error: write.error || "WB не принял медиа" }, { status: 502 });

    const session = await getServerSession();
    const { error } = await db.from("cover_tests").insert({
      cabinet_id: task.cabinetId,
      nm_id: task.nmId,
      article: product.article,
      photos_before: product.photos,
      photos_after: photosAfter,
      created_by: session?.email ?? null,
    });
    if (error) return NextResponse.json({ ok: false, error: `Фото опубликовано, но аудит не записан: ${error.message}` }, { status: 500 });
    return NextResponse.json({ ok: true, publishedAt: new Date().toISOString(), photosAfter });
  } catch (error) {
    const status = error instanceof UgcProductError ? error.status : 502;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не удалось опубликовать результат" }, { status });
  }
}
