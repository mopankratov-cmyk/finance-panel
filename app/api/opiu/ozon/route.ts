import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidDateParam } from "@/lib/opiu/weeks";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { readCachedAccrualTypeNames } from "@/lib/ozon/accrualTypesCache";
import { buildOzonOpiuReport, type OzonOpiuAccrualInput, type OzonOpiuPostingInput } from "@/lib/ozon/opiuOzonReport";
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
    .select("id")
    .eq("marketplace", "ozon")
    .eq("is_active", true);
  if (cabinetsError) return NextResponse.json({ error: cabinetsError.message }, { status: 502 });

  const requested = new Set(resolveCabinetIds(request));
  const cabinets = (allCabinets ?? []).filter((c) => requested.size === 0 || requested.has(String(c.id)));
  const cabinetIds = cabinets.map((c) => String(c.id));

  if (!cabinetIds.length) {
    return NextResponse.json({ report: null, cabinetIds: [], error: "Нет доступных кабинетов Ozon" }, { status: 200 });
  }

  // Supabase молча обрезает выборку на 1000 строк без ошибки — одно отправление
  // с продажей уже даёт строку комиссии плюс по одной на каждую услугу, так что
  // за месяц потолок перешагивается быстро (docs/PROJECT-KNOWLEDGE.md §4).
  // loadAllSupabasePages читает ВСЕ страницы с сортировкой по ключу.
  let accrualRows: OzonOpiuAccrualInput[];
  let postings: OzonOpiuPostingInput[];
  try {
    [accrualRows, postings] = await Promise.all([
      loadAllSupabasePages(
        async (from, to) => {
          const result = await db
            .from("ozon_accrual_rows")
            .select("cabinet_id, accrual_id, accrued_category, type_id, amount, extra")
            .in("cabinet_id", cabinetIds)
            .gte("date", dateFrom)
            .lte("date", dateTo)
            .order("cabinet_id", { ascending: true })
            .order("accrual_id", { ascending: true })
            .order("sku", { ascending: true })
            .order("type_id", { ascending: true })
            .range(from, to);
          return { data: result.data, error: result.error };
        },
        { label: "ozon_accrual_rows" },
      ).then((rows) =>
        rows.map((r) => ({
          // ID начисления уникален в пределах кабинета — склеиваем с кабинетом,
          // чтобы при выборе нескольких кабинетов начисления не смешались.
          accrual_id: `${r.cabinet_id}:${r.accrual_id}`,
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
    ]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }

  const typeNames = await readCachedAccrualTypeNames(db);

  const report = buildOzonOpiuReport({ accrualRows, postings, typeNames });
  const warning = buildOzonOpiuDateRangeWarning(dateFrom, new Date());
  return NextResponse.json({ report, cabinetIds, warning });
}
