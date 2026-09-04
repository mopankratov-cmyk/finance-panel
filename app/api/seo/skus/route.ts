import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { loadRnpDailySkuRows } from "@/lib/rnp/rpcLoaders";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { closedMoscowDates } from "@/lib/wb/sklejki";
import { funnelPeriodDates, percentRatio, resolveFunnelPeriod } from "@/lib/wb/funnelMetrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface FunnelRow { nm_id: number; date: string; open_card: number; add_to_cart: number; orders: number; orders_sum: number }
interface AdRow { nm_id: number; date: string; views: number; clicks: number; spent: number }
interface StockRow { nm_id: number; quantity: number | null }
interface ScopeRow { nm_id: number; article: string | null }

/**
 * Остатки склада продавца. В wb_stocks их нет: там только склады WB (FBO),
 * а FBS приходит другим методом Marketplace API и собирается в фоне
 * (app/api/sync/fbs-stocks). Отсутствие строки — это «не собирали», а не ноль,
 * поэтому экран отличает пустую карту от нулевого остатка.
 */
async function loadFbsStocks(cabinetId: string | null): Promise<Map<number, number> | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  // Читаем постранично. Без листания у кабинета с ассортиментом больше тысячи
  // товаров «хвост» не попадал в карту, и колонка FBS показывала по нему
  // уверенный ноль — тот самый случай, ради которого ветка ниже и написана.
  let data: Array<{ nm_id: number; quantity: number | null }>;
  try {
    data = await loadAllSupabasePages<{ nm_id: number; quantity: number | null }>((from, to) => {
      let query = db.from("wb_fbs_stocks")
        .select("nm_id, quantity")
        .order("nm_id", { ascending: true })
        .range(from, to);
      if (cabinetId) query = query.eq("cabinet_id", cabinetId);
      return query;
    }, { label: "Воронка: остатки FBS", maxPages: 100 });
  } catch {
    // Таблицы ещё нет или доступа нет — молчим и отдаём null: колонка честно
    // скажет «не собирали», вместо того чтобы показать нули.
    return null;
  }
  // И ни одной строки по кабинету — тоже «не собирали». Без этой ветки пустая
  // таблица давала уверенный ноль по каждому товару: обход ещё не запускался,
  // а экран уже утверждал, что на складе продавца пусто.
  if (!data.length) return null;
  return new Map(data.map((row) => [Number(row.nm_id), Number(row.quantity ?? 0)]));
}
interface DailySkuRow { nm_id: number; d: string; orders_count: number; orders_sum: number }
interface ProductCostRow { article: string; name: string | null; cost_rub: number | null }
interface RatingRow { nm_id: number; rating: number }

/**
 * Средняя оценка по SKU. Отзывов у кабинета бывают десятки тысяч, и это
 * вспомогательный слой: если чтение не укладывается в лимиты, экран честно
 * покажет «—» вместо рейтинга, но останется живым. Раньше отзывы читались
 * ПОСЛЕ основной пачки (нужен был список nm) и добавляли пять секунд ожидания
 * в чистом виде — теперь фильтр по кабинету позволяет читать их параллельно.
 */
async function loadRatings(cabinetId: string | null, allowedNmIds: Set<number> | null): Promise<Map<number, { sum: number; count: number }> | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  let rows: RatingRow[];
  try {
    rows = await loadAllSupabasePages<RatingRow>((from, to) => {
      let query = db.from("wb_feedbacks")
        .select("nm_id, rating")
        .order("nm_id", { ascending: true })
        .range(from, to);
      if (cabinetId) query = query.eq("cabinet_id", cabinetId);
      if (allowedNmIds) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
      return query;
    }, { label: "SEO: отзывы WB", concurrency: 4, maxPages: 200 });
  } catch {
    return null;
  }
  const ratings = new Map<number, { sum: number; count: number }>();
  for (const row of rows) {
    const nm = Number(row.nm_id);
    const entry = ratings.get(nm) ?? { sum: 0, count: 0 };
    entry.sum += Number(row.rating ?? 0);
    entry.count += 1;
    ratings.set(nm, entry);
  }
  return ratings;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (num: number, den: number) => (den > 0 ? r2((num / den) * 100) : null);
const ruDate = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;

function windowDays(raw: string | null): number {
  if (raw === "1" || raw === "yesterday") return 1;
  if (raw === "30" || raw === "month" || raw === "1m") return 30;
  return 7;
}

function selectedPeriod(days: number) {
  const dates = closedMoscowDates(days);
  const start = dates[0];
  const end = dates.at(-1)!;
  return { start, end, label: days === 1 ? ruDate(end) : `${ruDate(start)}-${ruDate(end)}` };
}

// Источник SKU для дизайн/«Воронка» (inferno loadDesign). Поля с суффиксом _7d (окно 7д) и _4d (вчера).
export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ skus: [], metrics_period: "" });

  const params = new URL(request.url).searchParams;
  // Кабинет из ?cabinet=<uuid|all> — фильтруем все источники по нему (или все, если "all").
  const { cabinetId, label } = await resolveShopCabinet(params.get("cabinet") ?? undefined);
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  // Произвольный диапазон (?date_from=&date_to=) в дополнение к пресетам ?window=1|7|30.
  const requested = resolveFunnelPeriod(params.get("date_from"), params.get("date_to"));
  if (!requested.ok) return NextResponse.json({ error: requested.error }, { status: 400 });
  const days = windowDays(params.get("window"));
  const period = requested.period
    ? { start: requested.period.start, end: requested.period.end, label: `${ruDate(requested.period.start)}-${ruDate(requested.period.end)}` }
    : selectedPeriod(days);
  // Длина периода — из самих границ, а не из ?window=: иначе оборачиваемость
  // произвольного диапазона считалась бы по чужому числу дней.
  const periodDays = funnelPeriodDates(period.start, period.end).length;

  // ?timings=1 — длительности источников в ответе, чтобы мерить узкие места
  // прямо на проде. Данных не раскрывает, роут и так под сессией.
  const wantTimings = params.get("timings") === "1";
  const timings: Record<string, number> = {};
  const timed = <T,>(name: string, promise: Promise<T> | PromiseLike<T>): Promise<T> => {
    if (!wantTimings) return Promise.resolve(promise);
    const startedAt = Date.now();
    const record = () => { timings[name] = Date.now() - startedAt; };
    return Promise.resolve(promise).then(
      (value) => { record(); return value; },
      (error) => { record(); throw error; },
    );
  };
  const payload = await loadHourlyDashboard(
    "wb-seo-skus",
    // Cache schema: 3 used advertising clicks as a fallback conversion denominator.
    // Схема 5: в строке появились stock_fbo и stock_fbs. Версию обязательно
    // поднимать вместе с формой данных — иначе экран получает вчерашний снимок
    // без новых полей, а по коду кажется, что фича раскатана.
    // Схема 6: в набор вернулись товары с переходами в карточку, но без рекламы,
    // заказов и остатка — раньше фильтр выбрасывал их молча; и ДРР товара без
    // рекламы перестал быть нулём.
    { cabinetId, start: period.start, end: period.end, days: periodDays, schema: 6 },
    async () => {
      const [funnel, ad, stocks, cards, scope, fbsStocks, costs, dailySku, ratingAgg] = await Promise.all([
        timed("funnel", loadAllSupabasePages<FunnelRow>((from, to) => {
          let query = db
            .from("wb_funnel_daily")
            .select("nm_id, date, open_card, add_to_cart, orders, orders_sum")
            .gte("date", period.start)
            .lte("date", period.end)
            .order("date", { ascending: true })
            .order("nm_id", { ascending: true })
            .range(from, to);
          if (cabinetId) query = query.eq("cabinet_id", cabinetId);
          if (allowedNmIds) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
          return query;
        }, { label: "SEO: воронка WB", concurrency: 4 })),
        timed("adverts", loadAllSupabasePages<AdRow>((from, to) => {
          let query = db
            .from("wb_advert_nm_daily")
            .select("nm_id, date, views, clicks, spent")
            .gte("date", period.start)
            .lte("date", period.end)
            .order("date", { ascending: true })
            .order("nm_id", { ascending: true })
            .range(from, to);
          if (cabinetId) query = query.eq("cabinet_id", cabinetId);
          if (allowedNmIds) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
          return query;
        }, { label: "SEO: реклама WB", concurrency: 4 })),
        // Остаток, артикул и себестоимость раньше приходили одним вызовом
        // rnp_report. Тот считает вдобавок заказы и выкупы за сегодня, вчера,
        // неделю и месяц — воронке они не нужны (она берёт заказы из
        // rnp_daily_sku), а сканы wb_orders и wb_sales за тридцать дней стоили
        // пятнадцать секунд из двадцати четырёх на холодном снимке. Читаем
        // ровно три недостающих поля из своих таблиц по индексу кабинета.
        timed("stocks", loadAllSupabasePages<StockRow>((from, to) => {
          let query = db
            .from("wb_stocks")
            .select("nm_id, quantity")
            .order("nm_id", { ascending: true })
            .range(from, to);
          if (cabinetId) query = query.eq("cabinet_id", cabinetId);
          if (allowedNmIds) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
          return query;
        }, { label: "SEO: остатки FBO", concurrency: 4, maxPages: 100 })),
        // Артикул берём из карточек WB — это текущее состояние каталога, которое
        // наполняет обход Content API. rnp_report предпочитал supplier_article
        // из заказов за месяц, то есть у переименованного товара показывал
        // СТАРЫЙ артикул, пока в окне оставались старые заказы.
        timed("cards", loadAllSupabasePages<ScopeRow>((from, to) => {
          let query = db
            .from("wb_cards")
            .select("nm_id, article")
            .order("nm_id", { ascending: true })
            .range(from, to);
          if (cabinetId) query = query.eq("cabinet_id", cabinetId);
          if (allowedNmIds) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
          return query;
        }, { label: "SEO: карточки WB", concurrency: 4 })),
        // Товарный контур — вторым слоем: он заполнен только у кабинетов с
        // ограничением по бренду, но там перекрывает карточки, которые обход
        // мог ещё не догнать. У кабинета без контура таблица просто пуста.
        timed("scope", loadAllSupabasePages<ScopeRow>((from, to) => {
          let query = db
            .from("wb_cabinet_product_scope")
            .select("nm_id, article")
            .order("nm_id", { ascending: true })
            .range(from, to);
          if (cabinetId) query = query.eq("cabinet_id", cabinetId);
          if (allowedNmIds) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
          return query;
        }, { label: "SEO: товарный контур", concurrency: 4 })),
        timed("fbs_stocks", loadFbsStocks(cabinetId)),
        timed("costs", loadAllSupabasePages<ProductCostRow>((from, to) => db
          .from("product_costs")
          .select("article, name, cost_rub")
          .order("article", { ascending: true })
          .range(from, to), { label: "SEO: себестоимость", concurrency: 4 })),
        timed("daily_sku", loadRnpDailySkuRows<DailySkuRow>(db, {
          from: period.start,
          to: period.end,
          cabinetId,
          allowedNmIds,
          label: "SEO: заказы WB",
          concurrency: 4,
        })),
        timed("feedbacks", loadRatings(cabinetId, allowedNmIds)),
      ]);

  // Заказы по nm/день для выручки ДО СПП — через server-side агрегат rnp_daily_sku
  // (orders_sum = coalesce(finished_price, total_price) = цена после скидки продавца = до СПП).
  // Раньше тут шёл постраничный скан wb_orders по сети — рвал соединение и вис на 70с+.
  const ordersByNm = new Map<number, Map<string, { cnt: number; sum: number }>>();
  for (const row of dailySku) {
    if (!requestAllowsNm(allowedNmIds, row.nm_id)) continue;
    const nm = Number(row.nm_id);
    const d = String(row.d).slice(0, 10);
    if (!ordersByNm.has(nm)) ordersByNm.set(nm, new Map());
    ordersByNm.get(nm)!.set(d, { cnt: Number(row.orders_count ?? 0), sum: Number(row.orders_sum ?? 0) });
  }

  const orderDates: string[] = [];
  for (const m of ordersByNm.values()) for (const d of m.keys()) orderDates.push(d);
  const dates = [...new Set([...funnel.map((r) => String(r.date).slice(0, 10)), ...ad.map((r) => String(r.date).slice(0, 10)), ...orderDates])].sort();
  const yest = period.end;
  const selected = new Set(dates.filter((d) => d >= period.start && d <= period.end));

  // Остаток FBO — сумма по складам WB, артикул — из каталога кабинета,
  // себестоимость и название — из product_costs по артикулу.
  const stockByNm = new Map<number, number>();
  for (const row of stocks) {
    const nm = Number(row.nm_id);
    stockByNm.set(nm, (stockByNm.get(nm) ?? 0) + Number(row.quantity ?? 0));
  }
  const articleByNm = new Map<number, string>();
  for (const row of [...cards, ...scope]) {
    const article = String(row.article ?? "").trim();
    if (article) articleByNm.set(Number(row.nm_id), article);
  }
  const nameByArt = new Map<string, string>();
  const costByArt = new Map<string, number>();
  for (const c of costs) {
    nameByArt.set(c.article, c.name ?? "");
    if (c.cost_rub != null) costByArt.set(c.article, Number(c.cost_rub));
  }

  // Товары с переходами в карточку раньше в набор не попадали: универсум брался
  // из рекламы и rnp_report, а туда товар без заказов, рекламы и остатка не
  // входит. На проде так пропадало полсотни артикулов с живым трафиком.
  const nmIds = [...new Set([
    ...funnel.map((r) => Number(r.nm_id)),
    ...ad.map((r) => Number(r.nm_id)),
    ...dailySku.map((r) => Number(r.nm_id)),
    ...stockByNm.keys(),
  ])].filter((nm) => Number.isFinite(nm) && requestAllowsNm(allowedNmIds, nm));

  // Раскладка фактов по nm ДО расчёта. Раньше agg() проходил по всем строкам
  // воронки и рекламы для каждого товара — триста товаров на тридцати днях
  // давали миллионы лишних сравнений на каждый холодный снимок.
  const indexByNm = <Row extends { nm_id: number }>(rows: Row[]) => {
    const map = new Map<number, Row[]>();
    for (const row of rows) {
      const nm = Number(row.nm_id);
      const list = map.get(nm);
      if (list) list.push(row); else map.set(nm, [row]);
    }
    return map;
  };
  const funnelByNm = indexByNm(funnel);
  const adByNm = indexByNm(ad);

  const agg = (nm: number, days: Set<string> | "yest") => {
    let views = 0, clicks = 0, spent = 0, cart = 0, oc = 0, os = 0, open = 0;
    const has = (d: string) => (days === "yest" ? d === yest : days.has(d));
    // воронка (показы/корзина/открытия) — из аналитики WB
    for (const f of funnelByNm.get(nm) ?? []) if (has(String(f.date).slice(0, 10))) { cart += f.add_to_cart || 0; open += f.open_card || 0; }
    for (const a of adByNm.get(nm) ?? []) if (has(String(a.date).slice(0, 10))) { views += a.views || 0; clicks += a.clicks || 0; spent += Number(a.spent || 0); }
    // заказы шт/₽ — из wb_orders ДО СПП
    const om = ordersByNm.get(nm);
    if (om) for (const [d, e] of om) if (has(d)) { oc += e.cnt; os += e.sum; }
    // Была ли реклама в этом окне на самом деле. Строка в wb_advert_nm_daily
    // сама по себе рекламой не является: у половины товаров она есть с нулями —
    // кампания их включала, но не откручивала. Отличать «расход ноль» от
    // «рекламы не было» обязательно: без этого ДРР товара, который вовсе не
    // рекламировался, выходил уверенным нулём — самой приятной и самой ложной
    // цифрой в таблице. На боевом кабинете так было у 84 товаров, включая тот,
    // что принёс 766 тысяч заказов.
    return { views, clicks, spent, cart, oc, os, open, hasAd: views > 0 || spent > 0 };
  };

  const skus = nmIds.map((nm) => {
    const art = articleByNm.get(nm) || String(nm);
    const cost = Number(costByArt.get(art) ?? 0);
    // FBO — склады WB (wb_stocks), FBS — склад продавца (собирается отдельно).
    // Складываем, а не подменяем: общий остаток должен видеть оба контура.
    const stockFbo = stockByNm.get(nm) ?? 0;
    const stockFbs = fbsStocks ? (fbsStocks.get(nm) ?? 0) : null;
    const stock = stockFbo + (stockFbs ?? 0);

    const w = agg(nm, selected);
    const y = agg(nm, "yest");

    const priceUnit = (a: typeof w) => (a.oc > 0 ? Math.round(a.os / a.oc) : 0);
    const margin = (a: typeof w) => { const p = priceUnit(a); return p > 0 && cost > 0 ? r2(((p - cost) / p) * 100) : null; };
    const turn = w.oc > 0 ? Math.round(stock / (w.oc / periodDays)) : null;

    const drr = (a: typeof w) => (a.hasAd ? pct(a.spent, a.os) : null);
    const mb7 = margin(w), drr7 = drr(w);
    const mb4 = margin(y), drr4 = drr(y);

    return {
      nm, art, shop: label || "Магазин", img_url: wbCardImageUrl(nm),
      name: nameByArt.get(art) || art,
      // окно 7 дней
      shows_7d: w.views, opens_7d: w.clicks || w.open, clicks_7d: w.clicks, ctr_7d: pct(w.clicks, w.views), cart_7d: w.cart,
      cv_cart_7d: percentRatio(w.cart, w.open), cv_order_7d: pct(w.oc, w.cart),
      orders_count_7d: w.oc, orders_sum_7d: Math.round(w.os),
      margin_before_drr_7d: mb7, drr_7d: drr7,
      // выбранное окно из ?window=1|7|30
      shows_window: w.views, opens_window: w.clicks || w.open, clicks_window: w.clicks, ctr_window: pct(w.clicks, w.views), cart_window: w.cart,
      open_card_window: w.open,
      cv_cart_window: percentRatio(w.cart, w.open), cv_order_window: pct(w.oc, w.cart),
      orders_count_window: w.oc, orders_sum_window: Math.round(w.os),
      margin_before_drr_window: mb7, drr_window: drr7,
      // окно вчера
      views_4d: y.views, clicks_4d: y.clicks, ctr_4d: pct(y.clicks, y.views), cart_4d: y.cart,
      orders_count_4d: y.oc, orders_sum_4d: Math.round(y.os),
      margin_pct_4d: mb4, sae_4d: drr4, profitability_4d: mb4 != null && drr4 != null ? r2(mb4 - drr4) : null,
      // общие
      price_before_spp_unit: priceUnit(w) || priceUnit(y),
      stock, stock_fbo: stockFbo, stock_fbs: stockFbs, turnover_4d: turn,
      rating: (() => { const fb = ratingAgg?.get(nm); return fb ? Math.round((fb.sum / fb.count) * 10) / 10 : null; })(),
      reviews: ratingAgg?.get(nm)?.count ?? null,
    };
  })
    // Товар с переходами в карточку, но без рекламы, заказов и остатка — это
    // ровно тот случай, ради которого воронку и открывают: трафик есть,
    // конверсии нет. Раньше такие строки экран не показывал вовсе.
    .filter((s) => s.shows_7d > 0 || s.orders_count_7d > 0 || s.stock > 0 || s.open_card_window > 0 || s.cart_window > 0)
    .sort((a, b) => b.orders_sum_7d - a.orders_sum_7d);

      return { skus, metrics_period: period.label, window_days: periodDays, count: skus.length };
    },
    {
      forceRefresh: params.get("refresh") === "1",
      backgroundRefresh: params.get("background") === "1",
    },
  );
  return NextResponse.json(wantTimings ? { ...payload, timings } : payload, { headers: { "X-Dashboard-Cache": "hourly-snapshot" } });
}
