import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { PdfRecognitionError } from "@/lib/finance/bankStatementPdf";
import { recognizeBankStatementUpload, suggestForStatement } from "@/lib/finance/bankStatementServer";

export const maxDuration = 120;

// Выписка (XLSX или PDF) → операции → предложения по компании, кошельку и
// статье. Всё на сервере: раньше XLSX и классификация жили в браузере, и
// результат зависел от того, кто загружает. Ответ: { statement, suggestions }.

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Добавьте выписку XLSX или PDF" }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Файл выписки больше 20 МБ" }, { status: 413 });
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".pdf") && file.type !== "application/pdf") {
      return NextResponse.json({ error: "Поддерживаются банковские выписки XLSX и PDF" }, { status: 415 });
    }
    const statement = await recognizeBankStatementUpload({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()), mimeType: file.type });
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Серверная база не настроена" }, { status: 503 });
    const suggestions = await suggestForStatement(db, statement);
    return NextResponse.json({ statement, suggestions });
  } catch (error) {
    if (error instanceof PdfRecognitionError) return NextResponse.json({ error: error.message }, { status: 502 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось прочитать выписку" }, { status: 500 });
  }
}
