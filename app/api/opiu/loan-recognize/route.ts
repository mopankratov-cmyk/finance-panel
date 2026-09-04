import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { RecognizedLoan } from "@/components/loans/loanRecognition";
import { aiConfigured, LoanAiUnavailableError, LoanRecognitionValidationError, recognizeLoanWithAi } from "@/lib/loans/aiRecognition";
import { fetchCbrRate } from "@/lib/loans/exchangeRate";
import { applyLoanCorrections, recognizeLoanDocument, type LoanRecognitionDeps } from "@/lib/loans/recognizeLoan";
import type { LoanScheduleDraft } from "@/lib/loans/schedule";
import { isUploadObjectPath, readUpload, removeUpload } from "@/lib/finance/uploadStorage";

export const maxDuration = 120;

// Распознавание договора целиком на сервере. Раньше браузер сам вытаскивал
// текст из DOCX/XLSX, гонял регулярки, звал ИИ, сливал результаты и строил
// график — и у разных сотрудников по одному документу выходило разное.
// Теперь три входа:
//  - multipart: file + description → полное распознавание (§recognizeLoanDocument);
//  - JSON { corrections, existingRecognition, schedule, exchangeRate } → корректировка текстом;
//  - JSON { text | pdfBase64 | imageBase64 } → только ИИ (старый контракт, оставлен для совместимости).

const MAX_REQUEST_BYTES = 28 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

async function buildDeps(): Promise<LoanRecognitionDeps> {
  const db = getSupabaseAdmin();
  const [companies, accounts] = db
    ? await Promise.all([
        db.from("companies").select("id,name").eq("is_active", true),
        db.from("accounts").select("id,name"),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  return {
    ai: aiConfigured() ? (body) => recognizeLoanWithAi(body) as Promise<Partial<RecognizedLoan>> : undefined,
    rate: async (currency) => {
      const result = await fetchCbrRate(currency);
      return { rate: result.rate, date: result.date };
    },
    companies: (companies.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name) })),
    accounts: (accounts.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name) })),
  };
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof LoanRecognitionValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof LoanAiUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Документ слишком большой" }, { status: 413 });
  }
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const file = form.get("file");
      const description = String(form.get("description") ?? "");
      if (file instanceof File && file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Файл договора больше 20 МБ" }, { status: 413 });
      if (!(file instanceof File) && !description.trim()) return NextResponse.json({ error: "Добавьте договор или опишите займ текстом." }, { status: 400 });
      const upload = file instanceof File && file.size > 0
        ? { name: file.name, bytes: Buffer.from(await file.arrayBuffer()), mimeType: file.type }
        : undefined;
      const result = await recognizeLoanDocument({ description, file: upload }, await buildDeps());
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error, "Не удалось прочитать документ");
    }
  }

  const body = await request.json().catch(() => null) as
    | { corrections?: string; existingRecognition?: RecognizedLoan; schedule?: LoanScheduleDraft[]; exchangeRate?: number; text?: string; pdfBase64?: string; imageBase64?: string; imageMediaType?: string; fileName?: string; storagePath?: string; description?: string; mimeType?: string }
    | null;
  if (!body) return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });

  // Большой файл пришёл через хранилище (см. lib/finance/uploadStorage.ts).
  if (body.storagePath !== undefined) {
    if (!isUploadObjectPath(body.storagePath)) return NextResponse.json({ error: "Некорректный путь файла" }, { status: 400 });
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Серверное хранилище не настроено" }, { status: 503 });
    try {
      const bytes = await readUpload(db, body.storagePath);
      const name = String(body.fileName ?? body.storagePath.split("/").pop() ?? "document");
      const result = await recognizeLoanDocument({ description: String(body.description ?? ""), file: { name, bytes, mimeType: String(body.mimeType ?? "") } }, await buildDeps());
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error, "Не удалось прочитать документ");
    } finally {
      void removeUpload(db, body.storagePath);
    }
  }

  if (body.corrections?.trim() && body.existingRecognition && Array.isArray(body.schedule)) {
    try {
      const result = await applyLoanCorrections({
        existing: body.existingRecognition,
        schedule: body.schedule,
        corrections: body.corrections,
        exchangeRate: Number(body.exchangeRate) || 1,
      }, await buildDeps());
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error, "Не удалось применить корректировки");
    }
  }

  // Старый контракт: только ИИ по тексту/PDF/картинке.
  if (!body.text?.trim() && !body.pdfBase64 && !body.imageBase64 && !body.corrections?.trim()) {
    return NextResponse.json({ error: "Добавьте текст, документ или изображение графика" }, { status: 400 });
  }
  try {
    return NextResponse.json(await recognizeLoanWithAi({
      text: body.text,
      pdfBase64: body.pdfBase64,
      imageBase64: body.imageBase64,
      imageMediaType: body.imageMediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp" | undefined,
      fileName: body.fileName,
      existingRecognition: body.existingRecognition,
      corrections: body.corrections,
    }));
  } catch (error) {
    return errorResponse(error, "Не удалось распознать договор");
  }
}
