import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidDateParam } from "@/lib/opiu/weeks";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { readOzonAdDaily } from "@/lib/ozon/adDailyRead";
import { readCachedAccrualTypeIds, readCachedAccrualTypeNames } from "@/lib/ozon/accrualTypesCache";
import { buildOzonOpiuReport, type OzonOpiuAccrualInput, type OzonOpiuPostingInput } from "@/lib/ozon/opiuOzonReport";
import { sumOzonAdSpend } from "@/lib/ozon/opiuOzonAdSpend";
import { buildOzonOpiuDateRangeWarning } from "@/lib/ozon/opiuOzonDateRangeWarning";

export const maxDuration = 60;

function resolveCabinetIds(request: NextRequest): string[] {
  return request.nextUrl.searchParams.getAll("cabinetId").filter(Boolean);
}

export async function GET(request: NextRequest) {
  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? "";
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? "";
  if (!isValidDateParam(dateFrom) || !isValidDateParam(dateTo) || dateFrom > dateTo) {
    return NextResponse.json({ error: "Некорректный диапазон дат" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const { data: allCabinets, error: cabinetsError } = await db
    .from("wb_cabinets")
    .select("id, client_id")
    .eq("marketplace", "ozon")
    .eq("is_active", true);
  if (cabinetsError) return NextResponse.json({ error: cabinetsError.message }, { status: 502 });

  const requested = new Set(resolveCabinetIds(request));
  const cabinets = (allCabinets ?? []).filter((c) => requested.size === 0 || requested.has(String(c.id)));
  const cabinetIds = cabinets.map((c) => String(c.id));
  const clientIds = cabinets.map((c) => String(c.client_id));

  if (!cabinetIds.length) {
    return NextResponse.json({ report: null, cabinetIds: [], error: "Нет доступных кабинетов Ozon" }, { status: 200 });
  }

  // Supabase молча обрезает выборку на 1000 строк без ошибки — обычный
  // ассортимент за месяц перешагивает этот потолок быстро (одно отправление
  // с продажей уже даёт строку комиссии плюс по одной на каждую услугу
  // доставки), см. docs/PROJECT-KNOWLEDGE.md §4 и finding C1 финального
  // ревью. loadAllSupabasePages читает ВСЕ страницы, с сортировкой по
  // первичному ключу для устойчивой пагинации.
  let accrualRows: OzonOpiuAccrualInput[];
  let postings: OzonOpiuPostingInput[];
  let adSpend: number;
  try {
    [accrualRows, postings, adSpend] = await Promise.all([
      loadAllSupabasePages(
        async (from, to) => {
          const result = await db
            .from("ozon_accrual_rows")
            .select("accrued_category, type_id, amount, extra")
            .in("cabinet_id", cabinetIds)
            .gte("date", dateFrom)
            .lte("date", dateTo)
            .order("accrual_id", { ascending: true })
            .order("sku", { ascending: true })
            .order("type_id", { ascending: true })
            .range(from, to);
          return { data: result.data, error: result.error };
        },
        { label: "ozon_accrual_rows" },
      ).then((rows) =>
        rows.map((r) => ({
          accrued_category: String(r.accrued_category),
          type_id: Number(r.type_id),
          amount: Number(r.amount),
          extra: (r.extra ?? null) as { sale_amount?: number } | null,
        })),
      ),
      loadAllSupabasePages(
        async (from, to) => {
          const result = await db
            .from("ozon_postings")
            .select("status, amount")
            .in("cabinet_id", cabinetIds)
            .gte("created_at", `${dateFrom}T00:00:00.000Z`)
            .lte("created_at", `${dateTo}T23:59:59.999Z`)
            .order("posting_number", { ascending: true })
            .range(from, to);
          return { data: result.data, error: result.error };
        },
        { label: "ozon_postings" },
      ).then((rows) => rows.map((r) => ({ status: String(r.status), amount: Number(r.amount) }))),
      // Итог по кабинету за день (sku='*') не всегда готов — разнесение по
      // товарам едет отдельными отчётами. Наивный запрос только по '*' терял
      // расход для кабинета/дня без готового итога (finding I1). readOzonAdDaily
      // читает ВСЕ строки за период (тоже постранично), sumOzonAdSpend
      // выбирает источник независимо для каждой пары (кабинет, день).
      readOzonAdDaily(db, clientIds, dateFrom, dateTo).then(({ rows }) => sumOzonAdSpend(rows.map((r) => ({
        client_id: String(r.client_id),
        sku: String(r.sku),
        date: String(r.date),
        spent: Number(r.spent ?? 0),
      })))),
    ]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }

  const [typeNames, knownTypeIds] = await Promise.all([
    readCachedAccrualTypeNames(db),
    readCachedAccrualTypeIds(db),
  ]);

  const report = buildOzonOpiuReport({ accrualRows, postings, adSpend, typeNames, knownTypeIds });
  const warning = buildOzonOpiuDateRangeWarning(dateFrom, new Date());
  return NextResponse.json({ report, cabinetIds, warning });
}
