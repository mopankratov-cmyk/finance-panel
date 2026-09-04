import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { PdfRecognitionError } from "@/lib/finance/bankStatementPdf";
import { recognizeBankStatementUpload, suggestForStatement } from "@/lib/finance/bankStatementServer";
import { isUploadObjectPath, readUpload, removeUpload } from "@/lib/finance/uploadStorage";

export const maxDuration = 120;

// Выписка (XLSX или PDF) → операции → предложения по компании, кошельку и
// статье. Всё на сервере: раньше XLSX и классификация жили в браузере, и
// результат зависел от того, кто загружает. Ответ: { statement, suggestions }.

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Серверная база не настроена" }, { status: 503 });
  let storagePath: string | null = null;
  try {
    let upload: { name: string; bytes: Buffer; mimeType: string };
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      // Большой файл пришёл через хранилище (см. lib/finance/uploadStorage.ts).
      const body = await request.json().catch(() => null) as { storagePath?: string; fileName?: string; mimeType?: string } | null;
      if (!body || !isUploadObjectPath(body.storagePath)) return NextResponse.json({ error: "Некорректный путь файла" }, { status: 400 });
      storagePath = body.storagePath;
      upload = { name: String(body.fileName ?? storagePath.split("/").pop() ?? "statement"), bytes: await readUpload(db, storagePath), mimeType: String(body.mimeType ?? "") };
    } else {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Добавьте выписку XLSX или PDF" }, { status: 400 });
      if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Файл выписки больше 20 МБ" }, { status: 413 });
      upload = { name: file.name, bytes: Buffer.from(await file.arrayBuffer()), mimeType: file.type };
    }
    const lower = upload.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".pdf") && upload.mimeType !== "application/pdf") {
      return NextResponse.json({ error: "Поддерживаются банковские выписки XLSX и PDF" }, { status: 415 });
    }
    const statement = await recognizeBankStatementUpload(upload);
    const suggestions = await suggestForStatement(db, statement);
    return NextResponse.json({ statement, suggestions });
  } catch (error) {
    if (error instanceof PdfRecognitionError) return NextResponse.json({ error: error.message }, { status: 502 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось прочитать выписку" }, { status: 500 });
  } finally {
    if (storagePath) void removeUpload(db, storagePath);
  }
}
