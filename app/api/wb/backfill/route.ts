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

  const body = (await request.json().catch(() => ({}))) as {
    cabinetId?: string;
    from?: string;
    to?: string;
    /** Сколько срезов воронки прогнать подряд. Каждый срез — 20 SKU. */
    funnelPasses?: number;
    /** Сколько раз дёрнуть глубокую историю. Отчёт WB готовится не мгновенно. */
    historyPasses?: number;
    /** Прогнать проверку токенов (все кабинеты): нужна после добавления скоупов. */
    checkTokens?: boolean;
    /**
     * Какие синки гонять. По умолчанию все три. Выбор нужен, когда один из них
     * упирается в таймаут на широком окне и рушит весь вызов: заказы за полмесяца
     * не влезают в лимит функции, а реклама по тому же окну проходит спокойно.
     */
    jobs?: string[];
  };
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

  // Заказы, продажи и статистику рекламы забираем последовательно: каждый прогон
  // тянет с WB тяжёлое окно, а параллельный запуск упирается в общий лимит площадки.
  const ALL_JOBS = ["orders", "sales", "advert-stats"] as const;
  const requested = Array.isArray(body.jobs) && body.jobs.length > 0
    ? ALL_JOBS.filter((job) => body.jobs!.includes(job))
    : ALL_JOBS;
  for (const job of requested) {
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

  // Воронка забирает по 20 SKU за прогон (лимит analytics-API WB — три запроса в
  // минуту), поэтому у кабинета на 350 SKU полный круг занимает почти сутки.
  // Здесь гоняем срезы подряд, пока есть бюджет функции: каждый вызов синка сам
  // двигает курсор среза, так что достаточно повторять запрос.
  const funnelPasses = Math.max(0, Math.min(20, Math.round(Number(body.funnelPasses ?? 0))));
  if (funnelPasses > 0) {
    const deadline = Date.now() + 200_000;
    let done = 0;
    let lastError: string | undefined;
    for (let pass = 0; pass < funnelPasses && Date.now() < deadline; pass++) {
      const url = new URL("/api/sync/funnel", base);
      url.searchParams.set("cabinet", cabinetId);
      try {
        const response = await fetch(url, { headers, cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok || payload.error) {
          lastError = payload.error ?? `HTTP ${response.status}`;
          break;
        }
        done++;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "запрос не выполнен";
        break;
      }
    }
    results.push({ job: "funnel", ok: !lastError, status: lastError ? 502 : 200, detail: lastError ?? `срезов: ${done}` });
  }

  // Глубокая история (DETAIL_HISTORY_REPORT) — единственный источник дней старше
  // окна дозаписи и единственное место, где WB отдаёт добавления в корзину.
  // Отчёт готовится не мгновенно: первый вызов его заказывает, следующие проверяют
  // готовность и скачивают. Поэтому дёргаем несколько раз с паузой.
  const historyPasses = Math.max(0, Math.min(10, Math.round(Number(body.historyPasses ?? 0))));
  if (historyPasses > 0) {
    const deadline = Date.now() + 240_000;
    let lastStatus = "не запускалась";
    let lastError: string | undefined;
    for (let pass = 0; pass < historyPasses && Date.now() < deadline; pass++) {
      if (pass > 0) await new Promise((resolve) => setTimeout(resolve, 20_000));
      try {
        const response = await fetch(new URL("/api/sync/history", base), { headers, cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as {
          errors?: string[];
          results?: Array<{ cabinet?: string; status?: string; reason?: string; rows?: number }>;
        };
        const mine = (payload.results ?? []).find((item) => item.cabinet === cabinet.name);
        lastStatus = mine?.status ?? `нет ответа по кабинету (HTTP ${response.status})`;
        if (mine?.status === "unavailable") { lastError = mine.reason ?? "WB не отдаёт отчёт"; break; }
        // complete — отчёт скачан и записан, дальше дёргать нечего.
        if (mine?.status === "complete") break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "запрос не выполнен";
        break;
      }
    }
    results.push({
      job: "history",
      ok: !lastError,
      status: lastError ? 502 : 200,
      detail: lastError ?? `статус: ${lastStatus}`,
    });
  }

  if (body.checkTokens === true) {
    try {
      const response = await fetch(new URL("/api/sync/token-health", base), { headers, cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; checked?: number };
      results.push({
        job: "token-health",
        ok: response.ok && !payload.error,
        status: response.status,
        detail: payload.error ?? (payload.checked != null ? `проверок: ${payload.checked}` : undefined),
      });
    } catch (error) {
      results.push({ job: "token-health", ok: false, status: 0, detail: error instanceof Error ? error.message : "запрос не выполнен" });
    }
  }

  return NextResponse.json({
    ok: results.every((result) => result.ok),
    cabinet: cabinet.name,
    period: { from, to: to || null },
    results,
    // Дни старше окна дозаписи закрывает DETAIL_HISTORY_REPORT — его тянет
    // ежечасный /api/sync/all, отдельного вызова отсюда не требуется.
    note: funnelPasses > 0
      ? "Срезы воронки прогнаны; дни старше окна дозаписи закроет ежечасное восстановление истории."
      : "Воронка догружается ежечасным восстановлением истории.",
  });
}
