import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess, sessionHasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { wbSyncHealthStatus } from "@/lib/sync/wbSyncHealthStatus";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { normalizeWbBrand } from "@/lib/wb/productScope";
import { WB_SCOPE_LABEL, type WbScope } from "@/lib/wb/token";

export const dynamic = "force-dynamic";

interface ScopeRow { cabinet_id: string; nm_id: number; brand: string | null }
interface StateRow { cabinet_id: string; job: string; cursor: string | null; status: string; attempts: number; last_error: string | null; state: Record<string, unknown>; updated_at: string }
interface TokenRow { cabinet_id: string; scope: WbScope; available: boolean | null; expires_at: string | null; days_left: number | null; checked_at: string; last_error: string | null }
interface FieldCoverage { field: string; label: string; filled: number; total: number; coveragePct: number | null; error: string | null }

const SOURCE_SLA_MINUTES: Record<string, number> = {
  orders: 90,
  sales: 90,
  stocks: 90,
  adverts: 90,
  "advert-stats": 180,
  funnel: 360,
  feedbacks: 180,
  commissions: 26 * 60,
};

async function sourceSnapshot(db: SupabaseClient, cabinetId: string, table: string, timestamp: string) {
  try {
    const result = await db
      .from(table)
      .select(timestamp, { count: "exact" })
      .eq("cabinet_id", cabinetId)
      .order(timestamp, { ascending: false })
      .limit(1);
    return {
      rows: result.count ?? 0,
      lastSyncedAt: result.error ? null : String(((result.data?.[0] as unknown) as Record<string, unknown> | undefined)?.[timestamp] ?? "") || null,
      error: result.error?.message ?? null,
    };
  } catch (error) {
    return {
      rows: 0,
      lastSyncedAt: null,
      error: error instanceof Error ? error.message : `Не удалось прочитать ${table}`,
    };
  }
}

async function fieldCoverageSnapshot(db: SupabaseClient, cabinetId: string, table: string, field: string, label: string): Promise<FieldCoverage> {
  try {
    const [totalResult, filledResult] = await Promise.all([
      db.from(table).select("id", { count: "exact", head: true }).eq("cabinet_id", cabinetId),
      db.from(table).select("id", { count: "exact", head: true }).eq("cabinet_id", cabinetId).not(field, "is", null),
    ]);
    const total = totalResult.count ?? 0;
    const filled = filledResult.count ?? 0;
    const error = totalResult.error?.message ?? filledResult.error?.message ?? null;
    return {
      field,
      label,
      filled,
      total,
      coveragePct: total > 0 ? Math.round((filled / total) * 1_000) / 10 : null,
      error,
    };
  } catch (error) {
    return {
      field,
      label,
      filled: 0,
      total: 0,
      coveragePct: null,
      error: error instanceof Error ? error.message : `Не удалось проверить ${label}`,
    };
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const session = await getServerSession();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  // ?warehouse_types=1&cabinet=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD — распределение
  // сырых значений warehouse_type по дням. Диагностика сплита ФБО/ФБС: сверка с
  // кабинетом Оптимы показала зеркально перевёрнутые числа в части дней, и без
  // сырых значений не отличить «WB прислал не то» от «мы не так классифицируем».
  const sp = request.nextUrl.searchParams;

  // ?funnel_probe=1&cabinet=<uuid> — какие поля реально отдаёт history-эндпоинт
  // воронки WB. Возвращаются только ИМЕНА ключей дня, не значения: нужно, чтобы
  // отличать «WB не отдаёт поле» от «мы не так его читаем» (история с addToWishList).
  if (sp.get("funnel_probe") === "1") {
    const cabinetId = sp.get("cabinet");
    if (!cabinetId) return NextResponse.json({ error: "Нужен cabinet" }, { status: 400 });
    if (!sessionHasCabinetAccess(session, cabinetId) || !(await hasCabinetAccess(cabinetId))) {
      return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
    }
    const target = (await getActiveWbCabinets()).find((cabinet) => cabinet.id === cabinetId);
    if (!target) return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 });
    const nmRow = await db.from("wb_funnel_daily").select("nm_id").eq("cabinet_id", cabinetId).limit(1).maybeSingle();
    const nmId = Number(nmRow.data?.nm_id);
    if (!Number.isFinite(nmId)) return NextResponse.json({ error: "Нет SKU с воронкой" }, { status: 404 });
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const response = await fetch("https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products/history", {
      method: "POST",
      headers: { Authorization: target.token, "Content-Type": "application/json" },
      body: JSON.stringify({ nmIds: [nmId], selectedPeriod: { start: yesterday, end: yesterday } }),
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ error: `WB ${response.status}: ${(await response.text()).slice(0, 150)}` }, { status: 502 });
    }
    const json = await response.json() as { data?: Array<{ history?: Array<Record<string, unknown>> }> } | Array<{ history?: Array<Record<string, unknown>> }>;
    const items = Array.isArray(json) ? json : json.data ?? [];
    const day = items[0]?.history?.[0];
    return NextResponse.json({ nmId, dayKeys: day ? Object.keys(day).sort() : [], items: items.length });
  }

  // ?advert_types=1&cabinet=<uuid> — какие значения bid_type реально прислал WB.
  // Нужны для сплита рекламы по видам кампаний: имена в анонсах и в живом API
  // у WB расходятся (см. историю addToWishlistCount), маппинг пишем по факту.
  // ?fbs_probe=1&cabinet=<uuid> — распределение сборочных заданий Marketplace по
  // датам создания. Сверка сплита ФБО/ФБС: наши числа разошлись с сервисом
  // кабинета, и без дат заданий не понять, чья семантика какая.
  if (sp.get("fbs_probe") === "1") {
    const cabinetId = sp.get("cabinet");
    if (!cabinetId) return NextResponse.json({ error: "Нужен cabinet" }, { status: 400 });
    if (!sessionHasCabinetAccess(session, cabinetId) || !(await hasCabinetAccess(cabinetId))) {
      return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
    }
    const rows = await loadAllSupabasePages<{ created_at_wb: string | null; nm_id: number }>(
      (start, end) => db.from("wb_fbs_orders")
        .select("created_at_wb, nm_id")
        .eq("cabinet_id", cabinetId)
        .order("created_at_wb", { ascending: true })
        .range(start, end),
      { maxPages: 30, label: "Диагностика FBS-заданий" },
    );
    const byDay: Record<string, number> = {};
    const byDayMsk: Record<string, number> = {};
    for (const row of rows) {
      const iso = String(row.created_at_wb ?? "");
      if (!iso) { byDay["<null>"] = (byDay["<null>"] ?? 0) + 1; continue; }
      byDay[iso.slice(0, 10)] = (byDay[iso.slice(0, 10)] ?? 0) + 1;
      const msk = new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 10);
      byDayMsk[msk] = (byDayMsk[msk] ?? 0) + 1;
    }
    return NextResponse.json({ cabinetId, total: rows.length, byDayUtc: byDay, byDayMsk });
  }

  // ?campaign_layer=1 — жив ли слой wb_advert_nm_campaign_daily: сколько строк,
  // за какие даты и что отвечает пробный upsert. Синк рапортует ok даже когда
  // слой не пишется (витрина собирается фолбэком), и без зонда «пусто» не
  // отличить от «не применена миграция» и «нет constraint под on_conflict».
  if (sp.get("campaign_layer") === "1") {
    const probe = await db
      .from("wb_advert_nm_campaign_daily")
      .select("date", { count: "exact" })
      .order("date", { ascending: false })
      .limit(1);
    const oldest = await db
      .from("wb_advert_nm_campaign_daily")
      .select("date")
      .order("date", { ascending: true })
      .limit(1);
    // Проверяем именно круг «записал → прочитал»: под включённой RLS без
    // политик запись может пройти без ошибки, а чтение вернуть пустоту, и по
    // отдельности оба шага выглядят здоровыми.
    const dryRun = await db
      .from("wb_advert_nm_campaign_daily")
      .upsert([{ cabinet_id: null, advert_id: -1, nm_id: -1, date: "1970-01-01", views: 0, clicks: 0, spent: 0, carts: 0, orders: 0, orders_sum: 0 }], { onConflict: "cabinet_id,advert_id,nm_id,date" });
    let roundTrip: number | null = null;
    if (!dryRun.error) {
      const readBack = await db
        .from("wb_advert_nm_campaign_daily")
        .select("advert_id", { count: "exact", head: true })
        .eq("advert_id", -1)
        .eq("nm_id", -1);
      roundTrip = readBack.count ?? 0;
      await db.from("wb_advert_nm_campaign_daily").delete().eq("advert_id", -1).eq("nm_id", -1);
    }
    const nmDaily = await db
      .from("wb_advert_nm_daily")
      .select("carts", { count: "exact" })
      .not("carts", "is", null)
      .limit(1);
    return NextResponse.json({
      rows: probe.count ?? null,
      newestDate: probe.data?.[0]?.date ?? null,
      oldestDate: oldest.data?.[0]?.date ?? null,
      selectError: probe.error?.message ?? null,
      upsertError: dryRun.error?.message ?? null,
      // 1 — запись видна сразу после вставки; 0 — пишем «в никуда».
      roundTrip,
      // Витрина знает корзины из РК только начиная с той же миграции.
      nmDailyWithCarts: nmDaily.count ?? null,
      nmDailyError: nmDaily.error?.message ?? null,
    });
  }

  // ?spend_split=1&cabinet=<uuid>&nm=<nmId> — где теряется расход по артикулу.
  // Сравнивает расход кампаний за день (wb_advert_stats, уровень кампании) с
  // суммой по артикулам той же кампании (слой wb_advert_nm_campaign_daily).
  // Расхождение означает, что WB не разнёс расход по nm, и брать его нужно с
  // уровня кампании.
  if (sp.get("spend_split") === "1") {
    const cabinetId = sp.get("cabinet");
    const nmId = Number(sp.get("nm"));
    if (!cabinetId || !Number.isSafeInteger(nmId)) {
      return NextResponse.json({ error: "Нужны cabinet и nm" }, { status: 400 });
    }
    if (!sessionHasCabinetAccess(session, cabinetId) || !(await hasCabinetAccess(cabinetId))) {
      return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
    }
    const layer = await loadAllSupabasePages<{ advert_id: number; date: string; spent: number | string | null; nm_id: number }>(
      (start, end) => db.from("wb_advert_nm_campaign_daily")
        .select("advert_id, date, spent, nm_id")
        .eq("cabinet_id", cabinetId)
        .eq("nm_id", nmId)
        .order("date", { ascending: false })
        .range(start, end),
      { maxPages: 10, label: "Диагностика расхода по артикулу" },
    );
    const advertIds = [...new Set(layer.map((row) => row.advert_id))].slice(0, 40);
    const dates = [...new Set(layer.map((row) => row.date))].slice(0, 20);
    const campaignLevel = advertIds.length && dates.length
      ? await db.from("wb_advert_stats")
        .select("advert_id, date, sum_spent")
        .eq("cabinet_id", cabinetId)
        .in("advert_id", advertIds)
        .in("date", dates)
      : { data: [], error: null };
    const perCampaign = new Map<string, number>();
    for (const row of (campaignLevel.data ?? []) as Array<{ advert_id: number; date: string; sum_spent: number | string | null }>) {
      perCampaign.set(`${row.advert_id}|${row.date}`, Number(row.sum_spent ?? 0));
    }
    // Сколько всего артикулов у кампании в этот день — от этого зависит,
    // можно ли отнести расход кампании к артикулу без деления.
    const siblings = advertIds.length && dates.length
      ? await db.from("wb_advert_nm_campaign_daily")
        .select("advert_id, date, nm_id, spent, spent_allocated")
        .eq("cabinet_id", cabinetId)
        .in("advert_id", advertIds)
        .in("date", dates)
        .limit(20000)
      : { data: [], error: null };
    const nmCount = new Map<string, number>();
    for (const row of (siblings.data ?? []) as Array<{ advert_id: number; date: string }>) {
      const key = `${row.advert_id}|${row.date}`;
      nmCount.set(key, (nmCount.get(key) ?? 0) + 1);
    }
    // Сумма расхода по ВСЕМ артикулам кампании за день: без неё нельзя
    // отличить «WB не разнёс расход» от «расход ушёл на другие артикулы той
    // же кампании» — по одной строке эти случаи выглядят одинаково.
    const nmSpentSum = new Map<string, number>();
    for (const row of (siblings.data ?? []) as Array<{ advert_id: number; date: string; spent: number | string | null; spent_allocated: number | string | null }>) {
      const key = `${row.advert_id}|${row.date}`;
      nmSpentSum.set(key, (nmSpentSum.get(key) ?? 0) + Number(row.spent ?? 0) + Number(row.spent_allocated ?? 0));
    }
    const rows = layer.slice(0, 25).map((row) => {
      const key = `${row.advert_id}|${row.date}`;
      const campaignSpent = perCampaign.get(key) ?? null;
      const nmSum = nmSpentSum.get(key) ?? null;
      return {
        date: row.date,
        advertId: row.advert_id,
        nmSpent: Number(row.spent ?? 0),
        campaignSpent,
        allNmSpent: nmSum,
        // Сколько расхода кампании не дошло ни до одного артикула.
        gap: campaignSpent != null && nmSum != null ? Math.round((campaignSpent - nmSum) * 100) / 100 : null,
        nmsInCampaign: nmCount.get(key) ?? null,
      };
    });
    return NextResponse.json({
      nmId,
      rows,
      totalGap: Math.round(rows.reduce((sum, row) => sum + (row.gap ?? 0), 0) * 100) / 100,
      campaignError: campaignLevel.error?.message ?? null,
    });
  }

  // ?cabinet_gap=1&cabinet=<uuid>&date=<ГГГГ-ММ-ДД> — сколько расхода кампаний
  // не дошло до артикулов за день. Считаем ТОЛЬКО по кампаниям, которые в
  // слое за этот день есть: кампания, до которой обход ещё не дошёл, — это
  // «не собрано», а не «не разнесено», и мешать их нельзя.
  if (sp.get("cabinet_gap") === "1") {
    const cabinetId = sp.get("cabinet");
    const date = sp.get("date");
    if (!cabinetId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Нужны cabinet и date (ГГГГ-ММ-ДД)" }, { status: 400 });
    }
    if (!sessionHasCabinetAccess(session, cabinetId) || !(await hasCabinetAccess(cabinetId))) {
      return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
    }
    const layer = await loadAllSupabasePages<{ advert_id: number; spent: number | string | null; spent_allocated: number | string | null }>(
      (start, end) => db.from("wb_advert_nm_campaign_daily")
        .select("advert_id, spent, spent_allocated")
        .eq("cabinet_id", cabinetId)
        .eq("date", date)
        .order("advert_id", { ascending: true })
        .range(start, end),
      { maxPages: 60, label: "Диагностика недостачи расхода", concurrency: 4 },
    );
    const byCampaign = new Map<number, number>();
    for (const row of layer) {
      byCampaign.set(row.advert_id, (byCampaign.get(row.advert_id) ?? 0) + Number(row.spent ?? 0) + Number(row.spent_allocated ?? 0));
    }
    const stats = await loadAllSupabasePages<{ advert_id: number; sum_spent: number | string | null }>(
      (start, end) => db.from("wb_advert_stats")
        .select("advert_id, sum_spent")
        .eq("cabinet_id", cabinetId)
        .eq("date", date)
        .order("advert_id", { ascending: true })
        .range(start, end),
      { maxPages: 60, label: "Диагностика расхода кампаний", concurrency: 4 },
    );
    let campaignTotal = 0, coveredCampaignTotal = 0, gap = 0, notCollected = 0, campaignsWithGap = 0;
    for (const row of stats) {
      const spent = Number(row.sum_spent ?? 0);
      campaignTotal += spent;
      const collected = byCampaign.get(row.advert_id);
      if (collected == null) { notCollected += spent; continue; }
      coveredCampaignTotal += spent;
      const diff = Math.round((spent - collected) * 100) / 100;
      if (diff > 0.01) { gap += diff; campaignsWithGap++; }
    }
    const layerTotal = [...byCampaign.values()].reduce((sum, value) => sum + value, 0);
    return NextResponse.json({
      date,
      campaignTotal: Math.round(campaignTotal * 100) / 100,
      layerTotal: Math.round(layerTotal * 100) / 100,
      // Расход кампаний, до которых обход слоя ещё не дошёл.
      notCollected: Math.round(notCollected * 100) / 100,
      // Расход собранных кампаний, не дошедший ни до одного артикула.
      gap: Math.round(gap * 100) / 100,
      gapPct: coveredCampaignTotal > 0 ? Math.round(gap / coveredCampaignTotal * 1000) / 10 : null,
      campaignsWithGap,
      campaignsInStats: stats.length,
      campaignsInLayer: byCampaign.size,
    });
  }

  // ?advert_raw=1&cabinet=<uuid> — какие поля WB реально отдаёт по кампании.
  // Сырая карточка v2/adverts сохраняется синком; по ней видно, есть ли у WB
  // собственный признак вида размещения, или его правда приходится собирать
  // из ставок.
  if (sp.get("advert_raw") === "1") {
    const cabinetId = sp.get("cabinet");
    if (!cabinetId) return NextResponse.json({ error: "Нужен cabinet" }, { status: 400 });
    if (!sessionHasCabinetAccess(session, cabinetId) || !(await hasCabinetAccess(cabinetId))) {
      return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
    }
    const { data, error } = await db
      .from("wb_adverts")
      .select("advert_id, name, status, bid_type, raw")
      .eq("cabinet_id", cabinetId)
      .not("raw", "is", null)
      .order("advert_id", { ascending: false })
      .limit(1000);
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    const rows = (data ?? []) as Array<{ advert_id: number; name: string | null; status: number | null; bid_type: string | null; raw: Record<string, unknown> | null }>;
    const keyCounts: Record<string, number> = {};
    const nmSettingKeys: Record<string, number> = {};
    for (const row of rows) {
      for (const key of Object.keys(row.raw ?? {})) keyCounts[key] = (keyCounts[key] ?? 0) + 1;
      const settings = (row.raw as { nm_settings?: Array<Record<string, unknown>> } | null)?.nm_settings ?? [];
      for (const setting of settings.slice(0, 1)) {
        for (const key of Object.keys(setting)) nmSettingKeys[key] = (nmSettingKeys[key] ?? 0) + 1;
      }
    }
    // Распределение по тому, что WB сам говорит о кампании: модель оплаты и
    // площадки. Именно из них должен собираться вид размещения.
    const combos: Record<string, number> = {};
    for (const row of rows) {
      const settings = (row.raw as { settings?: { payment_type?: string; placements?: { search?: boolean; recommendations?: boolean } } } | null)?.settings;
      const placements = settings?.placements;
      const where = placements?.search && placements?.recommendations ? "поиск+полки"
        : placements?.search ? "поиск"
          : placements?.recommendations ? "полки"
            : "не указано";
      const key = `${row.bid_type ?? "?"} | ${settings?.payment_type ?? "?"} | ${where}`;
      combos[key] = (combos[key] ?? 0) + 1;
    }
    return NextResponse.json({
      sampled: rows.length,
      topLevelKeys: keyCounts,
      nmSettingKeys,
      combos,
      sample: rows.slice(0, 2).map((row) => ({ advertId: row.advert_id, name: row.name, raw: row.raw })),
    });
  }

  // ?promotion_count=1&cabinet=<uuid> — что отдаёт v1/promotion/count. Этот
  // метод WB группирует кампании по ТИПУ (поиск, каталог, авто, единая), а
  // синк берёт v2/adverts, где типа нет вовсе. Если типы приходят — вид
  // размещения не нужно собирать из ставок и доразмечать руками.
  if (sp.get("promotion_count") === "1") {
    const cabinetId = sp.get("cabinet");
    if (!cabinetId) return NextResponse.json({ error: "Нужен cabinet" }, { status: 400 });
    if (!sessionHasCabinetAccess(session, cabinetId) || !(await hasCabinetAccess(cabinetId))) {
      return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
    }
    const target = (await getWbSyncTargets()).find((item) => item.cabinetId === cabinetId);
    if (!target) return NextResponse.json({ error: "Кабинет без токена продвижения" }, { status: 400 });
    const response = await fetch("https://advert-api.wildberries.ru/adv/v1/promotion/count", {
      headers: { Authorization: target.advertToken },
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ error: `WB ${response.status}: ${(await response.text()).slice(0, 200)}` }, { status: 502 });
    }
    const json = await response.json() as { adverts?: Array<{ type?: number; status?: number; count?: number; advert_list?: Array<{ advertId?: number }> }>; all?: number };
    const groups = (json.adverts ?? []).map((group) => ({
      type: group.type ?? null,
      status: group.status ?? null,
      count: group.count ?? (group.advert_list?.length ?? 0),
      sampleIds: (group.advert_list ?? []).slice(0, 3).map((item) => item.advertId),
    }));
    return NextResponse.json({ all: json.all ?? null, groups });
  }

  // ?cards=1[&cabinet=<uuid>] — наполняется ли справочник карточек. Бренд и
  // предмет для фильтров РНП берутся отсюда: кэш Next между роутами не
  // разделяется, и до таблицы «Категория» была пуста у всех артикулов.
  if (sp.get("cards") === "1") {
    const cabinetId = sp.get("cabinet");
    if (cabinetId && (!sessionHasCabinetAccess(session, cabinetId) || !(await hasCabinetAccess(cabinetId)))) {
      return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
    }
    const query = db
      .from("wb_cards")
      .select("nm_id, article, brand, subject, updated_at", { count: "exact" })
      .order("updated_at", { ascending: false })
      .limit(5);
    const { data, error, count } = await (cabinetId ? query.eq("cabinet_id", cabinetId) : query);
    return NextResponse.json({
      rows: count ?? null,
      error: error?.message ?? null,
      sample: (data ?? []).map((row) => ({
        nm: row.nm_id,
        article: row.article,
        brand: row.brand,
        subject: row.subject,
        updatedAt: row.updated_at,
      })),
    });
  }

  if (sp.get("advert_types") === "1") {
    const cabinetId = sp.get("cabinet");
    if (!cabinetId) return NextResponse.json({ error: "Нужен cabinet" }, { status: 400 });
    if (!sessionHasCabinetAccess(session, cabinetId) || !(await hasCabinetAccess(cabinetId))) {
      return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
    }
    const rows = await loadAllSupabasePages<{ bid_type: string | null; status: number | null }>(
      (start, end) => db.from("wb_adverts")
        .select("bid_type, status")
        .eq("cabinet_id", cabinetId)
        .order("advert_id", { ascending: true })
        .range(start, end),
      { maxPages: 20, label: "Диагностика типов кампаний" },
    );
    const byType: Record<string, number> = {};
    for (const row of rows) {
      const key = row.bid_type == null ? "<null>" : String(row.bid_type) || "<пусто>";
      byType[key] = (byType[key] ?? 0) + 1;
    }
    return NextResponse.json({ cabinetId, campaigns: rows.length, byType });
  }

  if (sp.get("warehouse_types") === "1") {
    const cabinetId = sp.get("cabinet");
    const from = sp.get("from");
    const to = sp.get("to");
    if (!cabinetId || !from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: "Нужны cabinet, from и to (ГГГГ-ММ-ДД)" }, { status: 400 });
    }
    if (!sessionHasCabinetAccess(session, cabinetId) || !(await hasCabinetAccess(cabinetId))) {
      return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
    }
    try {
      const rows = await loadAllSupabasePages<{ date: string; warehouse_type: string | null; is_cancel: boolean | null }>(
        (start, end) => db.from("wb_orders")
          .select("date, warehouse_type, is_cancel")
          .eq("cabinet_id", cabinetId)
          .gte("date", `${from}T00:00:00`)
          .lt("date", `${to}T23:59:59`)
          .order("date", { ascending: true })
          .range(start, end),
        { maxPages: 60, label: "Диагностика типов складов" },
      );
      const byDay: Record<string, Record<string, number>> = {};
      for (const row of rows) {
        if (row.is_cancel === true) continue;
        const day = String(row.date).slice(0, 10);
        const value = row.warehouse_type == null ? "<null>" : String(row.warehouse_type) || "<пусто>";
        byDay[day] = byDay[day] ?? {};
        byDay[day][value] = (byDay[day][value] ?? 0) + 1;
      }
      return NextResponse.json({ cabinetId, from, to, byDay });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Диагностика не удалась" }, { status: 502 });
    }
  }
  const sessionScoped = (await getActiveWbCabinets()).filter((cabinet) => sessionHasCabinetAccess(session, cabinet.id));
  const cabinetAccess = await Promise.all(sessionScoped.map((cabinet) => hasCabinetAccess(cabinet.id)));
  const cabinets = sessionScoped.filter((_cabinet, index) => cabinetAccess[index]);
  const cabinetIds = cabinets.map((cabinet) => cabinet.id);
  if (!cabinetIds.length) return NextResponse.json({ generatedAt: new Date().toISOString(), cabinets: [], warnings: [] });

  const warnings: string[] = [];
  let scopeRows: ScopeRow[] = [];
  try {
    scopeRows = await loadAllSupabasePages<ScopeRow>((from, to) => db
      .from("wb_cabinet_product_scope")
      .select("cabinet_id, nm_id, brand")
      .in("cabinet_id", cabinetIds)
      .order("cabinet_id", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(from, to), { maxPages: 1_000, label: "Диагностика товарного контура" });
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Не удалось прочитать товарный контур");
  }
  const [statesResult, tokensResult] = await Promise.all([
    db.from("wb_sync_state").select("cabinet_id, job, cursor, status, attempts, last_error, state, updated_at").in("cabinet_id", cabinetIds).order("updated_at", { ascending: false }),
    db.from("wb_token_health").select("cabinet_id, scope, available, expires_at, days_left, checked_at, last_error").in("cabinet_id", cabinetIds).order("checked_at", { ascending: false }),
  ]);
  if (statesResult.error) warnings.push(statesResult.error.message);
  if (tokensResult.error) warnings.push("Проверка токенов ещё не развёрнута или временно недоступна");
  const states = (statesResult.data ?? []) as StateRow[];
  const tokens = (tokensResult.data ?? []) as TokenRow[];

  const result = [];
  // Один кабинет создаёт 12 коротких диагностических запросов. Параллельный
  // fan-out по всем кабинетам давал около 50 одновременных обращений к
  // PostgREST и изредка превращал полностью здоровый экран в HTTP 500.
  // Последовательность по кабинетам сохраняет параллельность внутри одного
  // кабинета, но убирает опасный всплеск соединений.
  for (const cabinet of cabinets) {
    const cabinetScope = scopeRows.filter((row) => row.cabinet_id === cabinet.id);
    const uniqueNm = new Set(cabinetScope.map((row) => Number(row.nm_id)));
    const byBrand = cabinetScope.reduce<Record<string, number>>((acc, row) => {
      const brand = normalizeWbBrand(row.brand) || "unknown";
      acc[brand] = (acc[brand] ?? 0) + 1;
      return acc;
    }, {});
    const [sources, ordersPriceCoverage, ordersSppCoverage, salesPriceCoverage, salesSppCoverage] = await Promise.all([
      Promise.all([
        sourceSnapshot(db, cabinet.id, "wb_orders", "synced_at").then((value) => ({ job: "orders", ...value })),
        sourceSnapshot(db, cabinet.id, "wb_sales", "synced_at").then((value) => ({ job: "sales", ...value })),
        sourceSnapshot(db, cabinet.id, "wb_stocks", "synced_at").then((value) => ({ job: "stocks", ...value })),
        sourceSnapshot(db, cabinet.id, "wb_adverts", "synced_at").then((value) => ({ job: "adverts", ...value })),
        sourceSnapshot(db, cabinet.id, "wb_advert_stats", "date").then((value) => ({ job: "advert-stats", ...value })),
        sourceSnapshot(db, cabinet.id, "wb_funnel_daily", "date").then((value) => ({ job: "funnel", ...value })),
        sourceSnapshot(db, cabinet.id, "wb_feedbacks", "synced_at").then((value) => ({ job: "feedbacks", ...value })),
        sourceSnapshot(db, cabinet.id, "wb_nm_commissions", "synced_at").then((value) => ({ job: "commissions", ...value })),
      ]),
      fieldCoverageSnapshot(db, cabinet.id, "wb_orders", "price_with_disc", "Цена до СПП заказов"),
      fieldCoverageSnapshot(db, cabinet.id, "wb_orders", "spp", "SPP% заказов"),
      fieldCoverageSnapshot(db, cabinet.id, "wb_sales", "price_with_disc", "Цена до СПП продаж"),
      fieldCoverageSnapshot(db, cabinet.id, "wb_sales", "spp", "SPP% продаж"),
    ]);
    const cabinetStates = states.filter((state) => state.cabinet_id === cabinet.id);
    const stateByJob = new Map(cabinetStates.map((state) => [state.job, state]));
    const fieldCoverageByJob = new Map<string, FieldCoverage[]>([
      ["orders", [ordersPriceCoverage, ordersSppCoverage]],
      ["sales", [salesPriceCoverage, salesSppCoverage]],
    ]);
    result.push({
      id: cabinet.id,
      name: cabinet.name,
      brands: cabinet.brand_filters,
      scope: {
        restricted: cabinet.allowed_nm_ids !== null,
        total: uniqueNm.size,
        allowed: cabinet.allowed_nm_ids?.length ?? null,
        norvia: byBrand.norvia ?? 0,
        rioBox: byBrand.riobox ?? 0,
        updatedAt: stateByJob.get("product-scope")?.updated_at ?? null,
      },
      tokens: tokens.filter((token) => token.cabinet_id === cabinet.id).map((token) => ({
        scope: token.scope,
        label: WB_SCOPE_LABEL[token.scope],
        available: token.available,
        expiresAt: token.expires_at,
        daysLeft: token.days_left,
        checkedAt: token.checked_at,
        error: token.last_error,
      })),
      sources: sources.map((source) => {
        const state = stateByJob.get(source.job);
        const stateLastSyncedAt = typeof state?.state?.lastSyncedAt === "string" ? state.state.lastSyncedAt : null;
        const lastSyncedAt = stateLastSyncedAt || source.lastSyncedAt || state?.updated_at || null;
        const ageMinutes = lastSyncedAt
          ? Math.max(0, Math.round((Date.now() - new Date(lastSyncedAt).getTime()) / 60_000))
          : null;
        const slaMinutes = SOURCE_SLA_MINUTES[source.job] ?? 90;
        const stale = ageMinutes !== null && ageMinutes > slaMinutes;
        const progressStatus = state?.status;
        const health = wbSyncHealthStatus({
          sourceError: source.error,
          progressStatus,
          stateLastError: state?.last_error ?? null,
          stale,
          hasLastSyncedAt: Boolean(lastSyncedAt),
          coveragePct: Number(state?.state?.coveragePct ?? (source.lastSyncedAt ? 100 : 0)),
        });
        return {
          ...source,
          lastSyncedAt,
          status: health.status,
          stale,
          ageMinutes,
          slaMinutes,
          cursor: state?.cursor ?? null,
          attempts: state?.attempts ?? 0,
          coveragePct: Number(state?.state?.coveragePct ?? (source.lastSyncedAt ? 100 : 0)),
          fieldCoverage: fieldCoverageByJob.get(source.job) ?? [],
          stateUpdatedAt: state?.updated_at ?? null,
          lastError: health.lastError,
        };
      }),
    });
  }

  return NextResponse.json({ generatedAt: new Date().toISOString(), cabinets: result, warnings: [...new Set(warnings)] });
}
