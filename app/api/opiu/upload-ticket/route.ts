import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createUploadTicket, DIRECT_UPLOAD_THRESHOLD_BYTES, MAX_UPLOAD_BYTES } from "@/lib/finance/uploadStorage";

// Билет на прямую загрузку файла в хранилище (см. lib/finance/uploadStorage.ts):
// подписанный URL на один объект, действует ~2 часа. Нужен для файлов крупнее
// 4,5 МБ, которые не проходят через тело запроса Vercel-функции.
export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const body = await request.json().catch(() => null) as { fileName?: string; size?: number } | null;
  const fileName = String(body?.fileName ?? "").trim();
  const size = Number(body?.size ?? 0);
  if (!fileName || !Number.isFinite(size) || size <= 0) return NextResponse.json({ error: "Укажите файл" }, { status: 400 });
  if (size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "Файл больше 50 МБ" }, { status: 413 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Серверное хранилище не настроено" }, { status: 503 });
  try {
    const ticket = await createUploadTicket(db, fileName);
    return NextResponse.json({ ...ticket, threshold: DIRECT_UPLOAD_THRESHOLD_BYTES });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось выдать ссылку на загрузку" }, { status: 500 });
  }
}
