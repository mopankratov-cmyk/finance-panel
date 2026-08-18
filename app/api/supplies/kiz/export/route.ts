import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { loadCabinetPimRowsHourly, PimSnapshotColdError } from "@/lib/wb/cards";
import {
  buildKizBrandLists,
  parseKizReturnsRows,
  parseKizSalesRows,
  type KizBrandExport,
  type KizReturnLine,
  type KizSaleLine,
} from "@/lib/wb/kizCodes";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";
import { readXlsxRows } from "@/lib/xlsx/read";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILE_BYTES = 8 * 1024 * 1024;

export interface KizExportResponse {
  meta: {
    cabinetId: string;
    generatedAt: string;
    status: "ready";
    warnings: string[];
  } | null;
  data: {
    brands: KizBrandExport[];
    totalCodes: number;
    files: { fbs: string | null; dbs: string | null; returns: string | null };
  } | null;
  error: string | null;
}

const fail = (error: string, status: number) =>
  NextResponse.json<KizExportResponse>({ meta: null, data: null, error }, { status });

async function authorize(raw: string) {
  if (!raw || raw === "all" || raw.startsWith("group:")) {
    return { cabinetId: null, response: fail("Выберите один реальный WB-кабинет", 400) };
  }
  const cabinetId = (await resolveShopCabinet(raw)).cabinetId;
  if (!cabinetId) return { cabinetId: null, response: fail("Выберите один реальный WB-кабинет", 400) };
  if (!(await hasCabinetAccess(cabinetId))) return { cabinetId: null, response: fail("Нет доступа к кабинету", 403) };
  return { cabinetId, response: null };
}

/** Файл необязателен, но если он пришёл — проверяем строго. */
function takeFile(form: FormData, field: string, label: string): { file: File | null; error: string | null } {
  const value = form.get(field);
  if (value === null || value === "") return { file: null, error: null };
  if (!(value instanceof File)) return { file: null, error: `Поле «${label}» пришло не файлом` };
  if (!/\.xlsx$/i.test(value.name)) return { file: null, error: `«${label}»: поддерживается только .xlsx` };
  if (value.size <= 0 || value.size > MAX_FILE_BYTES) {
    return { file: null, error: `«${label}»: размер файла должен быть от 1 байта до 8 МБ` };
  }
  return { file: value, error: null };
}

async function rowsOf(file: File): Promise<string[][]> {
  return readXlsxRows(Buffer.from(await file.arrayBuffer()));
}

const lowerArticle = (value: string) => value.trim().toLocaleLowerCase("ru-RU");

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const form = await request.formData().catch(() => null);
  if (!form) return fail("Ожидается multipart/form-data", 400);

  const scope = await authorize(String(form.get("cabinetId") ?? ""));
  if (scope.response) return scope.response;
  const cabinetId = scope.cabinetId;

  const picked = [
    takeFile(form, "fbs", "Продажи FBS"),
    takeFile(form, "dbs", "Продажи DBS"),
    takeFile(form, "returns", "Возвраты"),
  ];
  const badFile = picked.find((item) => item.error);
  if (badFile?.error) return fail(badFile.error, 400);
  const [fbs, dbs, returns] = picked.map((item) => item.file);
  if (!fbs && !dbs && !returns) return fail("Загрузите хотя бы одну выгрузку из ЛК WB", 400);

  const warnings: string[] = [];
  const sales: KizSaleLine[] = [];
  const returnLines: KizReturnLine[] = [];

  try {
    if (fbs) {
      const parsed = parseKizSalesRows(await rowsOf(fbs), "FBS");
      sales.push(...parsed.lines);
      warnings.push(...parsed.warnings.map((text) => `Продажи FBS: ${text}`));
      warnings.push(...parsed.errors.slice(0, 10).map((text) => `Продажи FBS: ${text}`));
    }
    if (dbs) {
      const parsed = parseKizSalesRows(await rowsOf(dbs), "DBS");
      sales.push(...parsed.lines);
      warnings.push(...parsed.warnings.map((text) => `Продажи DBS: ${text}`));
      warnings.push(...parsed.errors.slice(0, 10).map((text) => `Продажи DBS: ${text}`));
    }
    if (returns) {
      const parsed = parseKizReturnsRows(await rowsOf(returns));
      returnLines.push(...parsed.lines);
      warnings.push(...parsed.warnings.map((text) => `Возвраты: ${text}`));
      warnings.push(...parsed.errors.slice(0, 10).map((text) => `Возвраты: ${text}`));
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Не удалось прочитать выгрузку", 422);
  }

  // Бренд берём из каталога кабинета, а не из отчёта: в выгрузках WB бренда
  // либо нет, либо он отличается от карточки. Снимок читаем только из кэша —
  // холодный обход Content API не укладывается в лимит роута.
  let pimRows;
  try {
    pimRows = await loadCabinetPimRowsHourly(cabinetId, { cacheOnly: true });
  } catch (error) {
    if (error instanceof PimSnapshotColdError) {
      return fail("Снимок карточек ещё не прогрет, повторите через минуту", 503);
    }
    return fail(error instanceof Error ? error.message : "Не удалось прочитать каталог кабинета", 502);
  }

  const brandByNm = new Map<number, string>();
  const brandByArticle = new Map<string, string>();
  const nmByArticle = new Map<string, number>();
  for (const row of pimRows) {
    const brand = (row.brand ?? "").trim();
    if (brand) {
      brandByNm.set(row.nmId, brand);
      if (row.article) brandByArticle.set(lowerArticle(row.article), brand);
    }
    if (row.article) nmByArticle.set(lowerArticle(row.article), row.nmId);
  }

  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  let blocked = 0;
  const resolveNm = (nmId: number | null, article: string) => nmId ?? nmByArticle.get(lowerArticle(article)) ?? null;
  const allows = (nmId: number | null) => allowedNmIds === null || (nmId !== null && allowedNmIds.has(nmId));

  const scopedSales = sales
    .map((line) => ({ ...line, nmId: resolveNm(line.nmId, line.article) }))
    .filter((line) => {
      if (allows(line.nmId)) return true;
      blocked += 1;
      return false;
    });
  const scopedReturns = returnLines
    .map((line) => ({ ...line, nmId: resolveNm(line.nmId, line.article) }))
    .filter((line) => {
      if (allows(line.nmId)) return true;
      blocked += 1;
      return false;
    });
  if (blocked) warnings.push(`Исключено строк вне товарного контура кабинета: ${blocked}`);

  const built = buildKizBrandLists({ sales: scopedSales, returns: scopedReturns, brandByNm, brandByArticle });
  warnings.push(...built.warnings);
  if (!built.totalCodes) warnings.push("Ни одного кода идентификации в выгрузках не найдено");

  return NextResponse.json<KizExportResponse>({
    meta: { cabinetId, generatedAt: new Date().toISOString(), status: "ready", warnings },
    data: {
      brands: built.brands,
      totalCodes: built.totalCodes,
      files: {
        fbs: fbs ? fbs.name.slice(0, 255) : null,
        dbs: dbs ? dbs.name.slice(0, 255) : null,
        returns: returns ? returns.name.slice(0, 255) : null,
      },
    },
    error: null,
  });
}
