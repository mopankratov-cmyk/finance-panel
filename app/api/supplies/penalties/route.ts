import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { cabinetProductScope, getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import {
  fetchWbPenalties,
  type WbPenaltyExclusions,
  type WbPenaltyRow,
  type WbPenaltySummary,
} from "@/lib/wb/penalties";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface PenaltiesResponse {
  meta: {
    cabinetId: string;
    generatedAt: string;
    status: "ready" | "partial";
    from: string;
    to: string;
    warnings: string[];
  };
  data: {
    rows: WbPenaltyRow[];
    summary: WbPenaltySummary[];
    /** Сумма показанных строк: итог выборки, а не всех удержаний кабинета. */
    total: number;
    /** Что в выборку не попало — чтобы экран мог назвать невидимую сумму. */
    exclusions: WbPenaltyExclusions;
  } | null;
  error: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WINDOW_DAYS = 92;

function meta(
  cabinetId: string,
  from: string,
  to: string,
  status: "ready" | "partial" = "ready",
  warnings: string[] = [],
): PenaltiesResponse["meta"] {
  return { cabinetId, generatedAt: new Date().toISOString(), status, from, to, warnings };
}

function fail(message: string, status: number, cabinetId = "", from = "", to = "") {
  const body: PenaltiesResponse = { meta: meta(cabinetId, from, to), data: null, error: message };
  return NextResponse.json(body, { status });
}

function windowDays(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toMs - fromMs) / 86_400_000) + 1;
}

// GET ?cabinet=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD — удержания WB за период из
// детализации финотчёта. Роут не падает: любая беда WB превращается в честный
// текст ошибки и пустой список, а не в 500 без объяснений.
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const params = new URL(request.url).searchParams;
  const rawCabinet = params.get("cabinet");
  if (!rawCabinet || rawCabinet === "all" || rawCabinet.startsWith("group:")) {
    return fail("Выберите один реальный WB-кабинет", 400);
  }
  // Тот же путь, что у соседних WB-роутов: кабинет обязан быть живым и WB-шным,
  // а не просто похожим на UUID.
  const { cabinetId } = await resolveShopCabinet(rawCabinet);
  if (!cabinetId) return fail("WB-кабинет не найден", 404);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403, cabinetId);

  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return fail("Укажите период в формате from=YYYY-MM-DD&to=YYYY-MM-DD", 400, cabinetId);
  }
  if (from > to) return fail("Начало периода позже его конца", 400, cabinetId, from, to);
  const days = windowDays(from, to);
  if (days > MAX_WINDOW_DAYS) {
    return fail(`Период длиннее ${MAX_WINDOW_DAYS} дней — финансовый отчёт WB не успеет выгрузиться`, 400, cabinetId, from, to);
  }

  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return fail("WB-кабинет не найден", 404, cabinetId, from, to);
  const token = resolveWbToken(cabinet, "statistics");
  if (!token) return fail("У кабинета нет WB-токена статистики — удержания читать нечем", 400, cabinetId, from, to);

  try {
    // Оставляем лямбде запас: дедлайн раньше maxDuration, чтобы успеть ответить собранным.
    const result = await fetchWbPenalties({
      token,
      dateFrom: from,
      dateTo: to,
      scope: cabinetProductScope(cabinet),
      deadlineMs: Date.now() + 50_000,
    });
    const warnings = result.complete
      ? []
      : [result.incompleteReason ?? "Финансовый отчёт не догружен — показаны собранные строки"];
    const body: PenaltiesResponse = {
      meta: meta(cabinetId, from, to, result.complete ? "ready" : "partial", warnings),
      data: {
        rows: result.rows,
        summary: result.summary,
        total: result.total,
        exclusions: result.exclusions,
      },
      error: null,
    };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "WB не отдал финансовый отчёт";
    // Finance API пускает один запрос в минуту — на 429 отдаём именно 429,
    // чтобы UI предложил подождать, а не показывал «нет удержаний».
    const status = message.includes("WB 429") ? 429 : 502;
    return fail(message, status, cabinetId, from, to);
  }
}
