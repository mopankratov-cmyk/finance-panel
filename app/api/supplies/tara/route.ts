import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { parseTaraRows, type TaraLine } from "@/lib/supplies/tara";
import { restrictTaraLines } from "@/lib/supplies/wms";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchCabinetCards } from "@/lib/wb/cards";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";
import { readXlsxRows } from "@/lib/xlsx/read";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code ?? "");

async function cabinet(raw: string | null) {
  if (!raw || raw === "all" || raw.startsWith("group:")) return null;
  return (await resolveShopCabinet(raw)).cabinetId;
}

async function authorize(raw: string | null) {
  const cabinetId = await cabinet(raw);
  if (!cabinetId) return { cabinetId: null, response: fail("Выберите один реальный WB-кабинет", 400) };
  if (!(await hasCabinetAccess(cabinetId))) return { cabinetId: null, response: fail("Нет доступа к кабинету", 403) };
  return { cabinetId, response: null };
}

function summary(lines: TaraLine[]) {
  return {
    containers: new Set(lines.map((line) => line.container.trim().toLocaleLowerCase("ru-RU"))).size,
    skuRows: lines.length,
    quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    volumeLiters: lines.reduce((sum, line) => sum + (line.volumeLiters ?? 0), 0),
  };
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const scope = await authorize(new URL(request.url).searchParams.get("cabinet"));
  if (scope.response) return scope.response;
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const { data, error } = await db.from("wms_tara_imports").select("id, file_name, file_hash, columns, summary, imported_by, created_at, updated_at").eq("cabinet_id", scope.cabinetId).eq("status", "active").maybeSingle();
  if (error) return fail(missingMigration(error.code) ? "Примените миграцию 20260713_wms_tara.sql" : error.message, missingMigration(error.code) ? 503 : 500);
  return NextResponse.json({ data: { activeImport: data ?? null }, error: null });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const form = await request.formData().catch(() => null);
  if (!form) return fail("Ожидается multipart/form-data", 400);
  const scope = await authorize(String(form.get("cabinetId") ?? ""));
  if (scope.response) return scope.response;
  const mode = form.get("mode") === "activate" ? "activate" : "preview";
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Выберите containerscontent.xlsx", 400);
  if (!/\.xlsx$/i.test(file.name)) return fail("Поддерживается только .xlsx", 400);
  if (file.size <= 0 || file.size > 8 * 1024 * 1024) return fail("Размер XLSX должен быть от 1 байта до 8 МБ", 400);

  let parsed;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
    parsed = parseTaraRows(readXlsxRows(buffer));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Не удалось прочитать XLSX", 422);
  }

  const allowedNmIds = await requestAllowedNmIds(scope.cabinetId);
  let articleToNmId = new Map<string, number>();
  if (allowedNmIds !== null) {
    const cards = await fetchCabinetCards(scope.cabinetId);
    articleToNmId = new Map(cards.map((card) => [card.article.trim().toLocaleLowerCase("ru-RU"), card.nm_id]));
  }
  const restricted = restrictTaraLines(parsed.lines, allowedNmIds, articleToNmId);
  const warnings = [...parsed.warnings];
  if (restricted.blocked) warnings.push(`Исключено строк вне товарного контура кабинета: ${restricted.blocked}`);
  if (restricted.unresolved) warnings.push(`Не загружено строк без подтверждённого nmId кабинета: ${restricted.unresolved}`);
  if (!restricted.lines.length && !parsed.errors.length) parsed.errors.push("После кабинетного фильтра в файле не осталось разрешённых позиций");
  const filteredSummary = summary(restricted.lines);
  const preview = {
    fileName: file.name.slice(0, 255),
    fileHash: createHash("sha256").update(buffer).digest("hex"),
    headerRow: parsed.headerRow,
    columns: parsed.columns,
    summary: filteredSummary,
    sourceSummary: parsed.summary,
    errors: parsed.errors,
    warnings,
    lines: restricted.lines.slice(0, 100),
    hiddenLines: Math.max(0, restricted.lines.length - 100),
  };
  if (mode === "preview") return NextResponse.json({ data: { preview }, error: null });
  if (parsed.errors.length) return NextResponse.json({ data: { preview }, error: "Исправьте ошибки файла перед активацией" }, { status: 422 });

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();
  const { data, error } = await db.rpc("save_wms_tara_import", {
    p_import: { cabinetId: scope.cabinetId, fileName: preview.fileName, fileHash: preview.fileHash, columns: preview.columns, summary: preview.summary, lines: restricted.lines },
    p_actor: session?.email ?? null,
  });
  if (error) return fail(missingMigration(error.code) ? "Примените миграцию 20260713_wms_tara.sql" : error.message, missingMigration(error.code) ? 503 : 500);
  return NextResponse.json({ data: { preview, activeImport: data }, error: null });
}
