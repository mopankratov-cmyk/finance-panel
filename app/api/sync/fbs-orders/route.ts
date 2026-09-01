import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsertWithOptionalColumns, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { allowsNm } from "@/lib/wb/productScope";
import { isWbGlobalRateLimitMessage } from "@/lib/wb/rateLimit";
import { readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// FBS-заказы из Marketplace API — единственный достоверный признак схемы продажи.
// warehouseType в статистике метит «Складом продавца» и FBO-отгрузки из транзитных
// СЦ (сверка с кабинетом 2026-08-17), поэтому сплит по нему отключён; здесь — прямой
// факт: сборочное задание Marketplace существует только у FBS-заказа.
//
// srid статистики соответствует rid сборочного задания — по нему заказы из
// wb_orders опознаются как FBS при сборке РНП.
const ORDERS_URL = "https://marketplace-api.wildberries.ru/api/v3/orders";
const PAGE_LIMIT = 1000;
// Стартовое окно покрывает месячный экран РНП с запасом.
// Глубина первого прогона. У WB dateFrom не может быть старше 30 суток —
// на 35 он отвечает 400 IncorrectParameter. Ловушка была самоподдерживающейся:
// без успешного прогона кабинет не получал курсор, а без курсора снова просил
// 35 дней. CLERIN и COSMOS так и не собрали ни одного задания.
// Замер 23.08.2026: с окном 10 дней те же кабинеты прошли без ошибок (4457
// строк), с 35 — падали каждый раз. Берём 28 с запасом на часовые пояса.
const INITIAL_DAYS = 28;
const JOB = "fbs-orders";

interface MarketplaceOrder {
  /** Числовой id сборочного задания — по нему запрашиваются коды маркировки. */
  id?: number;
  rid?: string;
  nmId?: number;
  createdAt?: string;
  article?: string;
  /** Баркоды задания. Первый участвует в сопоставлении кода маркировки. */
  skus?: string[];
}

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const sp = request.nextUrl.searchParams;
  const onlyCabinet = sp.get("cabinet");
  // ?from=YYYY-MM-DD — принудительное окно (бэкфилл истории кабинета).
  const forceFrom = sp.get("from");
  if (forceFrom && !/^\d{4}-\d{2}-\d{2}$/.test(forceFrom)) {
    return NextResponse.json({ error: "Некорректный параметр from" }, { status: 400 });
  }
  const allTargets = await getWbSyncTargets();
  const targets = (onlyCabinet ? allTargets.filter((target) => target.cabinetId === onlyCabinet) : allTargets)
    .filter((target) => target.cabinetId);
  if (!targets.length) return NextResponse.json({ error: "Нет активных кабинетов" }, { status: 404 });

  let total = 0;
  const errors: string[] = [];
  /** Кабинеты, которых притормозил WB: подождать, а не чинить. */
  const deferred: string[] = [];
  // Неполный обход — не ошибка кабинета, но и не успех: держим отдельным
  // списком, чтобы он дошёл и до ответа, и до журнала синхронизаций.
  const incomplete: string[] = [];
  const progress: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    const cabinetId = target.cabinetId!;
    try {
      const saved = forceFrom ? null : await readWbSyncState(db, cabinetId, JOB);
      // Дозапись с перехлёстом: сборочное задание может появиться позже создания
      // заказа, поэтому каждый прогон перечитывает последние два дня курсора.
      const cursorMs = saved?.cursor ? Date.parse(saved.cursor) - 2 * 86_400_000 : NaN;
      const fromMs = forceFrom
        ? Date.parse(`${forceFrom}T00:00:00Z`)
        : Number.isFinite(cursorMs)
          ? cursorMs
          : startedAt.getTime() - INITIAL_DAYS * 86_400_000;
      const rows: Array<Record<string, unknown>> = [];
      const seenCreatedAt: string[] = [];
      let next = 0;
      // Обход ограничен шестьюдесятью страницами. Раньше упор в этот предел
      // выглядел как «всё прочитано»: курсор двигался на конец окна, статус
      // писался caught_up, и непрочитанный хвост заданий терялся навсегда.
      let drained = false;
      for (let page = 0; page < 60; page++) {
        const url = new URL(ORDERS_URL);
        url.searchParams.set("limit", String(PAGE_LIMIT));
        url.searchParams.set("next", String(next));
        url.searchParams.set("dateFrom", String(Math.floor(fromMs / 1000)));
        url.searchParams.set("dateTo", String(Math.floor(startedAt.getTime() / 1000)));
        let response = await fetch(url, { headers: { Authorization: target.statsToken }, cache: "no-store" });
        // Глобальный лимитер продавца: тем же Marketplace API пользуется его
        // собственный сервис (кейс Оптимы — их поллинг выедает лимит почти
        // непрерывно). WB присылает в 429 заголовок, СКОЛЬКО ждать, — ждём его,
        // а не слепую паузу; без заголовка отступаем по нарастающей.
        for (let attempt = 0; response.status === 429 && attempt < 4; attempt++) {
          const hinted = Number(
            response.headers.get("X-Ratelimit-Retry")
            ?? response.headers.get("Retry-After")
            ?? NaN,
          );
          const waitMs = Number.isFinite(hinted) && hinted > 0
            ? Math.min(hinted, 55) * 1000
            : (attempt + 1) * 15_000;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          response = await fetch(url, { headers: { Authorization: target.statsToken }, cache: "no-store" });
        }
        if (!response.ok) {
          throw new Error(`WB ${response.status}: ${(await response.text()).slice(0, 120)}`);
        }
        const json = (await response.json()) as { next?: number; orders?: MarketplaceOrder[] };
        const orders = json.orders ?? [];
        for (const order of orders) {
          const createdAt = String(order.createdAt ?? "").trim();
          if (createdAt) seenCreatedAt.push(createdAt);
          const srid = String(order.rid ?? "").trim();
          const nmId = Number(order.nmId);
          if (!srid || !Number.isFinite(nmId)) continue;
          if (!allowsNm(target.productScope, nmId)) continue;
          const orderId = Number(order.id);
          rows.push({
            cabinet_id: cabinetId,
            srid,
            nm_id: nmId,
            // Числовой id задания: по нему запрашиваются коды маркировки.
            // Без него фоновый сборщик выкачивал этот же список у WB заново
            // на каждом прогоне — только чтобы узнать идентификаторы.
            order_id: Number.isFinite(orderId) ? orderId : null,
            // Артикул и баркод — чтобы экран сверки читал задания из базы, а
            // не выкачивал у WB весь список после каждой сборки.
            article: String(order.article ?? "").trim() || null,
            barcode: Array.isArray(order.skus) && order.skus.length
              ? String(order.skus[0] ?? "").trim() || null
              : null,
            created_at_wb: order.createdAt ?? null,
            synced_at: startedAt.toISOString(),
          });
        }
        next = Number(json.next ?? 0);
        if (orders.length < PAGE_LIMIT || !next) { drained = true; break; }
      }

      // order_id помечен необязательным: до применения миграции синк просто
      // не пишет колонку, а не падает целиком.
      const upsertResult = rows.length
        ? await chunkedUpsertWithOptionalColumns("wb_fbs_orders", rows, "cabinet_id,srid", ["order_id", "article", "barcode"])
        : null;
      const upsertError = upsertResult?.error ?? null;
      if (upsertError) throw new Error(upsertError);
      total += rows.length;
      // Принудительное окно тоже двигает состояние: период фактически покрыт,
      // и без записи покрытия РНП молчал бы, хотя факты уже в базе.
      const existing = forceFrom ? await readWbSyncState(db, cabinetId, JOB) : saved;
      const coveredCandidates = [String(existing?.state.coveredFrom ?? ""), new Date(fromMs).toISOString().slice(0, 10)]
        .filter(Boolean)
        .sort();
      // Курсор — «докуда просмотрели», а не дата последнего задания: у кабинета
      // без FBS-заказов заданий нет вовсе, и курсор по ним застревал на старте
      // окна, оставляя весь период неклассифицированным. Мы запросили окно до
      // startedAt и WB ответил — значит покрыто до startedAt; хвост опоздавших
      // заданий закрывает двухдневный перехлёст следующего прогона.
      // Если обход упёрся в предел страниц, окно НЕ покрыто: двигаем курсор
      // только до последнего реально прочитанного задания и говорим об этом
      // вслух. Иначе следующий прогон начал бы с конца окна, а пропущенные
      // задания не увидел бы уже никто.
      // Граница — по последнему ПРОСМОТРЕННОМУ заданию, а не по последнему
      // сохранённому. У агентского кабинета почти все задания чужие: если
      // считать только свои, у кабинета без единого своего задания в первых
      // шестидесяти страницах курсор замирал бы навсегда и каждый прогон читал
      // бы те же страницы.
      const lastReadAt = seenCreatedAt.sort().at(-1) ?? null;
      const frontier = drained ? startedAt.toISOString() : lastReadAt;
      const cursorCandidates = [String(existing?.cursor ?? ""), frontier ?? ""].filter(Boolean).sort();
      const truncationNote = drained
        ? null
        : `обход остановлен на пределе 60 страниц, окно прочитано не полностью (${rows.length} заданий)`;
      await writeWbSyncState(db, cabinetId, JOB, {
        cursor: cursorCandidates[cursorCandidates.length - 1] || null,
        status: drained ? "caught_up" : "running",
        attempts: 0,
        lastError: truncationNote,
        state: {
          coveredFrom: coveredCandidates[0],
          lastRunAt: startedAt.toISOString(),
          rows: rows.length,
          ...(drained ? {} : { truncated: true }),
        },
      });
      if (truncationNote) incomplete.push(`${target.name}: ${truncationNote}`);
      progress.push({ cabinet: target.name, rows: rows.length, status: drained ? "caught_up" : "running", truncated: !drained });
    } catch (error) {
      const message = error instanceof Error ? error.message : "неизвестная ошибка";
      // 429 — лимит площадки, а не наш сбой. Курсор не двигаем и попытки НЕ
      // накручиваем: счётчик attempts нужен для настоящих отказов, а от лимита
      // он растёт сам собой у агентских кабинетов и обесценивает сигнал.
      const throttled = isWbGlobalRateLimitMessage(message);
      if (throttled) deferred.push(`${target.name}: ${message}`);
      else errors.push(`${target.name}: ${message}`);
      if (!forceFrom) {
        const saved = await readWbSyncState(db, cabinetId, JOB);
        await writeWbSyncState(db, cabinetId, JOB, {
          cursor: saved?.cursor ?? null,
          status: throttled ? "running" : "error",
          attempts: throttled ? (saved?.attempts ?? 0) : (saved?.attempts ?? 0) + 1,
          lastError: message,
          state: throttled
            ? { ...(saved?.state ?? {}), lastRateLimitedAt: new Date().toISOString() }
            : saved?.state ?? {},
        });
      }
      progress.push({ cabinet: target.name, status: throttled ? "deferred" : "error", error: message });
    }
  }

  // Притормозили лимитом — это «partial»: часть кабинетов не обновилась, но
  // чинить нечего. Красный журнал на штатный лимит прячет настоящие сбои.
  const status = errors.length ? "error" : deferred.length ? "partial" : "ok";
  const ok = status === "ok";
  const logNote = [...errors, ...deferred, ...incomplete].join("; ") || null;
  await writeSyncLog(JOB, status, total, logNote, startedAt);
  // error дублирует errors первой строкой: бэкфилл показывает именно его.
  return NextResponse.json(
    { ok, rows: total, cabinets: targets.length, progress, errors, incomplete, error: errors[0] ?? undefined },
    { status: ok ? 200 : 502 },
  );
}
