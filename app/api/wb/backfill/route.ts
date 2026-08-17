import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Догрузка истории кабинета за период.
//
// Живая лента статистики WB стартует с «сейчас минус два часа» (см.
// initialStatisticsCursor): у только что подключённого кабинета заказы и выкупы
// за прошлые дни просто отсутствуют, и экраны показывают нули там, где на самом
// деле были продажи. Забрать их можно только принудительным прогоном синка с
// параметром from, а он закрыт cron-секретом — то есть недоступен из интерфейса.
//
// Этот роут — та же операция, но под обычной сессией: владелец подключил кабинет
// и должен уметь сам сказать «забери историю с начала месяца», не имея доступа к
// секретам окружения. Секрет подставляется на сервере, наружу не уходит.
const WRITE_ROLES = ["director", "finance"] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface JobResult {
  job: string;
  ok: boolean;
  status: number;
  detail?: string;
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession([...WRITE_ROLES]);
  if (gate) return gate;

  const body = (await request.json().catch(() => ({}))) as { cabinetId?: string; from?: string; to?: string };
  const cabinetId = String(body.cabinetId ?? "").trim();
  const from = String(body.from ?? "").trim();
  const to = String(body.to ?? "").trim();
  if (!cabinetId) return NextResponse.json({ error: "Укажите кабинет" }, { status: 400 });
  if (!DATE.test(from)) return NextResponse.json({ error: "Укажите дату начала в формате ГГГГ-ММ-ДД" }, { status: 400 });
  if (to && !DATE.test(to)) return NextResponse.json({ error: "Некорректная дата окончания" }, { status: 400 });

  const cabinets = await getActiveWbCabinets();
  const cabinet = cabinets.find((item) => item.id === cabinetId);
  if (!cabinet) return NextResponse.json({ error: "Активный WB-кабинет не найден" }, { status: 404 });

  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET не настроен на сервере" }, { status: 503 });

  const base = new URL(request.url).origin;
  const headers = { Authorization: `Bearer ${secret}` };
  const results: JobResult[] = [];

  // Заказы и продажи забираем последовательно: каждый прогон тянет с WB тяжёлое
  // окно, а параллельный запуск двух отчётов упирается в общий лимит площадки.
  for (const job of ["orders", "sales"] as const) {
    const url = new URL(`/api/sync/${job}`, base);
    url.searchParams.set("from", from);
    if (to) url.searchParams.set("to", to);
    url.searchParams.set("cabinet", cabinetId);
    try {
      const response = await fetch(url, { headers, cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; rows?: number; upserted?: number };
      results.push({
        job,
        ok: response.ok && !payload.error,
        status: response.status,
        detail: payload.error ?? (payload.upserted != null ? `строк: ${payload.upserted}` : payload.rows != null ? `строк: ${payload.rows}` : undefined),
      });
    } catch (error) {
      results.push({ job, ok: false, status: 0, detail: error instanceof Error ? error.message : "запрос не выполнен" });
    }
  }

  return NextResponse.json({
    ok: results.every((result) => result.ok),
    cabinet: cabinet.name,
    period: { from, to: to || null },
    results,
    // Воронку (показы, корзины, выкупы по дням) отдельно дёргать не нужно:
    // её историю за год забирает DETAIL_HISTORY_REPORT в ежечасном /api/sync/all.
    note: "Воронка догружается ежечасным восстановлением истории.",
  });
}
