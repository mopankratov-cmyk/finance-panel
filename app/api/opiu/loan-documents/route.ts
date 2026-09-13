import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 60;

const BUCKET = "finance-loan-documents";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 120;
const DOCUMENT_KINDS = new Set(["contract", "schedule", "amendment", "statement", "other"]);
const MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

type LoanDocumentRow = {
  id: string;
  loan_id: string;
  company_id: string | null;
  file_name: string;
  object_path: string;
  mime_type: string;
  size_bytes: number;
  document_kind: string;
  created_at: string;
};

class DocumentStorageError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

function text(value: FormDataEntryValue | string | null | undefined, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validLoanId(value: string) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function uuidOrNull(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function extension(fileName: string) {
  const match = fileName.toLowerCase().match(/(\.[a-z0-9]{1,10})$/);
  return match?.[1] ?? "";
}

function normalizedMimeType(file: File) {
  if (MIME_TYPES.has(file.type)) return file.type;
  return MIME_BY_EXTENSION[extension(file.name)] ?? "";
}

/**
 * Сигнатуры первых байт — то, что реально лежит в файле, а не то, что клиент
 * написал в Content-Type или в расширении имени. Оба подделываются в любом
 * HTTP-клиенте одной строкой; сервер их до сих пор не проверял.
 *
 * DOCX и XLSX — это один и тот же ZIP-контейнер снаружи, отличить их по
 * байтам нельзя (различие — в содержимом архива, не в заголовке), поэтому обе
 * сигнатуры — общий признак «это вообще ZIP». То же для DOC/XLS — оба это
 * OLE-контейнер с одним и тем же заголовком.
 */
const MAGIC_PREFIX: Record<string, number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46], // %PDF
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [0x50, 0x4b, 0x03, 0x04], // ZIP
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [0x50, 0x4b, 0x03, 0x04], // ZIP
  "application/msword": [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], // OLE
  "application/vnd.ms-excel": [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], // OLE
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/gif": [0x47, 0x49, 0x46, 0x38], // "GIF8", общий для GIF87a и GIF89a
};

/** WebP — контейнер RIFF: `RIFF` в начале, 4 байта длины блока, затем `WEBP`. */
function isWebpContainer(bytes: Buffer): boolean {
  const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return bytes.length >= 12 && isRiff && isWebp;
}

/**
 * Заявленный тип против реальных байт — там, где у формата вообще есть
 * надёжная сигнатура.
 *
 * У CSV сигнатуры нет: это обычный текст, и «похоже на CSV» ничем не
 * подтвердить и незачем изображать проверку там, где её структурно не может
 * быть — поэтому для text/csv сверку сознательно пропускаем.
 */
function matchesMagicBytes(mimeType: string, bytes: Buffer): boolean {
  if (mimeType === "text/csv") return true;
  if (mimeType === "image/webp") return isWebpContainer(bytes);
  const prefix = MAGIC_PREFIX[mimeType];
  return prefix ? prefix.every((byte, i) => bytes[i] === byte) : true;
}

function storageSetupError(message: string) {
  return /finance_loan_documents|schema cache|relation .* does not exist/i.test(message);
}

async function database() {
  const db = getSupabaseAdmin();
  if (!db) {
    throw new DocumentStorageError("Серверное хранилище документов не настроено", 503);
  }
  return db;
}

async function ensurePrivateBucket(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>) {
  const { data, error } = await db.storage.getBucket(BUCKET);
  if (data) {
    if (data.public) {
      const { error: updateError } = await db.storage.updateBucket(BUCKET, {
        public: false,
        fileSizeLimit: MAX_FILE_BYTES,
        allowedMimeTypes: [...MIME_TYPES],
      });
      if (updateError) throw new DocumentStorageError(`Не удалось закрыть хранилище: ${updateError.message}`);
    }
    return;
  }
  if (error && !/not found|does not exist/i.test(error.message)) {
    throw new DocumentStorageError(`Не удалось проверить хранилище: ${error.message}`);
  }
  const { error: createError } = await db.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_FILE_BYTES,
    allowedMimeTypes: [...MIME_TYPES],
  });
  if (createError && !/already exists/i.test(createError.message)) {
    throw new DocumentStorageError(`Не удалось создать хранилище: ${createError.message}`);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof DocumentStorageError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Ошибка хранилища документов" },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES + 1024 * 1024) {
      throw new DocumentStorageError("Файл договора превышает 25 МБ", 413);
    }
    const form = await request.formData();
    const file = form.get("file");
    const loanId = text(form.get("loanId"), 128);
    const companyId = text(form.get("companyId"), 128) || null;
    const documentKind = text(form.get("documentKind"), 32) || "contract";
    const mimeType = file instanceof File ? normalizedMimeType(file) : "";
    if (!validLoanId(loanId)) throw new DocumentStorageError("Некорректный идентификатор договора", 400);
    if (!(file instanceof File) || file.size === 0) throw new DocumentStorageError("Выберите файл договора", 400);
    if (file.size > MAX_FILE_BYTES) throw new DocumentStorageError("Файл договора превышает 25 МБ", 413);
    if (!mimeType) throw new DocumentStorageError("Формат файла не поддерживается", 415);
    if (!DOCUMENT_KINDS.has(documentKind)) throw new DocumentStorageError("Некорректный тип документа", 400);

    // Дальше договор с хранилищем строим на реальных байтах, а не на
    // заголовке: читаем файл один раз и этот же bytes уходит в storage.upload
    // ниже — без заявленного типа, подделанного поверх произвольного
    // содержимого, файл прошёл бы проверку выше и лёг в приватный бакет как
    // будто это настоящий договор.
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!matchesMagicBytes(mimeType, bytes)) {
      throw new DocumentStorageError("Файл не похож на заявленный формат — содержимое не совпадает", 415);
    }

    const db = await database();
    await ensurePrivateBucket(db);
    const objectPath = `${loanId}/${randomUUID()}${extension(file.name)}`;
    const { error: uploadError } = await db.storage.from(BUCKET).upload(objectPath, bytes, {
      contentType: mimeType,
      upsert: false,
    });
    if (uploadError) throw new DocumentStorageError(`Не удалось загрузить файл: ${uploadError.message}`);

    const session = await getServerSession();
    const { data, error } = await db
      .from("finance_loan_documents")
      .insert({
        loan_id: loanId,
        company_id: companyId,
        file_name: file.name.slice(0, 255),
        object_path: objectPath,
        mime_type: mimeType,
        size_bytes: file.size,
        document_kind: documentKind,
        uploaded_by: uuidOrNull(session?.uid),
      })
      .select("id,loan_id,company_id,file_name,mime_type,size_bytes,document_kind,created_at")
      .single();
    if (error) {
      await db.storage.from(BUCKET).remove([objectPath]);
      if (storageSetupError(error.message)) {
        throw new DocumentStorageError("Таблица документов кредитов не настроена в Supabase", 503);
      }
      throw new DocumentStorageError(`Не удалось сохранить карточку документа: ${error.message}`);
    }
    return NextResponse.json({ ok: true, document: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  try {
    const loanId = new URL(request.url).searchParams.get("loanId")?.trim() ?? "";
    if (!validLoanId(loanId)) throw new DocumentStorageError("Некорректный идентификатор договора", 400);
    const db = await database();
    const documentId = new URL(request.url).searchParams.get("documentId")?.trim() ?? "";
    const query = db
      .from("finance_loan_documents")
      .select("id,loan_id,company_id,file_name,object_path,mime_type,size_bytes,document_kind,created_at")
      .eq("loan_id", loanId)
      .order("created_at", { ascending: false });
    if (documentId) query.eq("id", documentId);
    const { data, error } = await query.returns<LoanDocumentRow[]>();
    if (error) {
      if (storageSetupError(error.message)) {
        throw new DocumentStorageError("Таблица документов кредитов не настроена в Supabase", 503);
      }
      throw new DocumentStorageError(`Не удалось найти документ: ${error.message}`);
    }
    if (!data?.length) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
    const documents = await Promise.all(data.map(async (row) => {
      const { data: signed, error: signError } = await db.storage
        .from(BUCKET)
        .createSignedUrl(row.object_path, SIGNED_URL_TTL_SECONDS);
      if (signError || !signed?.signedUrl) {
        throw new DocumentStorageError(`Не удалось открыть документ ${row.file_name}: ${signError?.message ?? "signed URL не создан"}`);
      }
      return {
        id: row.id,
        loanId: row.loan_id,
        companyId: row.company_id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        documentKind: row.document_kind,
        createdAt: row.created_at,
        url: signed.signedUrl,
      };
    }));
    return NextResponse.json(
      {
        ok: true,
        documents,
        document: documents[0],
        url: documents[0].url,
        expiresIn: SIGNED_URL_TTL_SECONDS,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  try {
    const body = await request.json().catch(() => null) as { loanId?: string } | null;
    const loanId = body?.loanId?.trim() ?? "";
    if (!validLoanId(loanId)) throw new DocumentStorageError("Некорректный идентификатор договора", 400);
    const db = await database();
    const { data, error } = await db
      .from("finance_loan_documents")
      .select("id,object_path")
      .eq("loan_id", loanId);
    if (error) {
      if (storageSetupError(error.message)) {
        throw new DocumentStorageError("Таблица документов кредитов не настроена в Supabase", 503);
      }
      throw new DocumentStorageError(`Не удалось найти документы: ${error.message}`);
    }
    const rows = data ?? [];
    if (rows.length === 0) return NextResponse.json({ ok: true, deleted: 0 });
    const { error: storageError } = await db.storage.from(BUCKET).remove(rows.map((row) => row.object_path));
    if (storageError) throw new DocumentStorageError(`Не удалось удалить файлы: ${storageError.message}`);
    const { error: deleteError } = await db
      .from("finance_loan_documents")
      .delete()
      .in("id", rows.map((row) => row.id));
    if (deleteError) throw new DocumentStorageError(`Не удалось удалить карточки документов: ${deleteError.message}`);
    return NextResponse.json({ ok: true, deleted: rows.length });
  } catch (error) {
    return errorResponse(error);
  }
}
