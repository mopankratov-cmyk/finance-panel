import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { getSheetValues, appendSheetRows, ensureSheetTab, type SheetCell } from "@/lib/google/sheets";

// Выгрузка поставок WB (supplier/incomes) в Google Sheets — отдельная вкладка «Поставки WB»
// в файле «Поставки ИП Панкратов» (тот же файл, где lib/opiu/fetchGoogleCosts.ts читает
// себестоимость на gid=0 — эту вкладку не трогаем, пишем только в свою).
// Только строки со статусом «Принято». Существующие строки не трогаем —
// на каждый прогон дочитываем уже записанные (incomeId+barcode) и дописываем в конец только новые.
export const maxDuration = 60;

const SPREADSHEET_ID = process.env.SUPPLIES_SHEET_ID || "1LLo9jYSdXZMCvdtgFTN-e1S4FTwCM4YYyKxsrbZ6Oc4";
const SHEET_NAME = process.env.SUPPLIES_SHEET_TAB || "Поставки WB";
const STATUS_ACCEPTED = "Принято";
const HEADER = ["incomeId", "date", "supplierArticle", "techSize", "barcode", "quantity", "dateClose", "nmId", "status", "lastChangeDate"];
// Окно по lastChangeDate (WB dateFrom фильтрует именно по нему) — с запасом, чтобы не терять
// поставки, у которых статус сменился на «Принято» не сразу.
const LOOKBACK_DAYS = 120;

interface WbIncome {
  incomeId: number;
  date: string;
  lastChangeDate: string;
  supplierArticle: string;
  techSize: string;
  barcode: string;
  quantity: number;
  dateClose: string;
  nmId: number;
  status: string;
}

function dedupeKey(incomeId: SheetCell, barcode: SheetCell): string {
  return `${incomeId}|${barcode}`;
}

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const targets = await getWbSyncTargets();
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов и WB_STATS_TOKEN не настроен" }, { status: 500 });
  }

  const dateFrom = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const errors: string[] = [];
  const collected: SheetCell[][] = [];

  for (const t of targets) {
    try {
      const url = new URL("https://statistics-api.wildberries.ru/api/v1/supplier/incomes");
      url.searchParams.set("dateFrom", dateFrom);

      const res = await fetch(url.toString(), { headers: { Authorization: t.statsToken }, cache: "no-store" });
      if (!res.ok) {
        errors.push(`${t.name}: WB ${res.status}: ${(await res.text()).slice(0, 120)}`);
        continue;
      }

      const incomes = (await res.json()) as WbIncome[];
      for (const inc of incomes) {
        if (inc.status !== STATUS_ACCEPTED) continue;
        collected.push([
          inc.incomeId,
          inc.date,
          inc.supplierArticle,
          inc.techSize,
          inc.barcode,
          inc.quantity,
          inc.dateClose,
          inc.nmId,
          inc.status,
          inc.lastChangeDate,
        ]);
      }
    } catch (err) {
      errors.push(`${t.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  let appended = 0;
  try {
    await ensureSheetTab(SPREADSHEET_ID, SHEET_NAME, HEADER);
    const existing = await getSheetValues(SPREADSHEET_ID, `'${SHEET_NAME}'!A2:J`);
    if (existing === null) {
      errors.push("sheet: не удалось прочитать таблицу (проверьте GOOGLE_SERVICE_ACCOUNT_B64 и доступ сервис-аккаунта к таблице)");
    } else {
      const existingKeys = new Set(existing.map((r) => dedupeKey(r[0], r[4])));
      const newRows = collected.filter((r) => !existingKeys.has(dedupeKey(r[0], r[4])));
      if (newRows.length) {
        await appendSheetRows(SPREADSHEET_ID, `'${SHEET_NAME}'!A:J`, newRows);
        appended = newRows.length;
      }
    }
  } catch (err) {
    errors.push(`sheet: ${err instanceof Error ? err.message : "Unknown error"}`);
  }

  const ok = errors.length === 0;
  await writeSyncLog("supplies-sheet", ok ? "ok" : "error", appended, errors.join("; ") || null, startedAt);
  return NextResponse.json({ ok, appended, collected: collected.length, cabinets: targets.length, errors });
}
