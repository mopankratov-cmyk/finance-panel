import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { getWbCommissionForCabinet } from "@/lib/wb/commissions";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // факт-комиссия = финотчёт по каждому кабинету (тяжёлый, кэш 6ч)

interface RpcRow {
  nm_id: number;
  article: string;
  orders_month: number;
  orders_sum_month: number;
  buyouts_month: number;
  stock: number;
  in_way_to_client: number;
  cost: number | null;
  ad_spend_month: number;
}

// Юнит-экономика WB «1 в 1» с инферноф (формула калькулятора Юры):
// Прибыль/ед = Цена до СПП − Себес − Фулфилмент − Комиссия% − Эквайринг% − Реклама(ДРР)% − Налог%
// Комиссия/эквайринг/налог/фулфилмент — настраиваемые дефолты «поправь под факт» (?comm=&acq=&tax=&ff=&margin=).
// СПП %/Цена после СПП НЕ считаем — в БД нет (discount_percent ≠ СПП).
export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ headers: [], rows: [], img_urls: [] });

  const sp = new URL(req.url).searchParams;
  const num = (k: string, def: number) => { const v = Number(sp.get(k)); return Number.isFinite(v) && sp.get(k) !== null ? v : def; };
  const commDefault = num("comm", 25); // фолбэк, если фактической комиссии по nm нет
  const acqDefault = num("acq", 1.5);  // фолбэк эквайринга
  const taxPct = num("tax", 7);        // налог
  const ff = num("ff", 0);             // фулфилмент ₽/ед (нет per-SKU данных)
  const targetMargin = num("margin", 25); // целевая маржа для «цены до СПП для N% маржи»
  const { cabinetId: p_cabinet } = await resolveShopCabinet(sp.get("cabinet") ?? undefined);
  if (!(await hasCabinetAccess(p_cabinet))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const allowedNmIds = await requestAllowedNmIds(p_cabinet);

  const [rpcRes, costsRes, comm] = await Promise.all([
    db.rpc("rnp_report", { p_cabinet }),
    db.from("product_costs").select("article, name, entity, cost_rub, warehouse_expenses"),
    getWbCommissionForCabinet(p_cabinet, 30),
  ]);
  // ставки по nm: факт из отчёта → средняя по кабинету → дефолт
  const commForNm = (nm: number) => comm.byNm.get(nm)?.pct ?? (comm.avgPct > 0 ? comm.avgPct : commDefault);
  const acqForNm = (nm: number) => comm.byNm.get(nm)?.acqPct ?? (comm.avgAcqPct > 0 ? comm.avgAcqPct : acqDefault);
  const meta = new Map<string, { name: string; cat: string; storage: number }>();
  for (const c of costsRes.data ?? []) meta.set(c.article as string, { name: (c.name as string) ?? "", cat: (c.entity as string) ?? "", storage: Number(c.warehouse_expenses ?? 0) });

  const r0 = (n: number) => Math.round(n);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const blank = (n: number | null) => (n == null || !isFinite(n) ? "" : n);

  const rows: (string | number)[][] = [];
  const img_urls: string[] = [];
  const names: string[] = [];

  const sorted = ((rpcRes.data ?? []) as RpcRow[]).filter((row) => requestAllowsNm(allowedNmIds, row.nm_id)).slice().sort((a, b) => Number(b.orders_sum_month) - Number(a.orders_sum_month));

  for (const r of sorted) {
    const m = meta.get(r.article);
    const orders = r.orders_month;
    const rev = Number(r.orders_sum_month);
    const cost = Number(r.cost ?? 0);
    const ad = Number(r.ad_spend_month ?? 0);
    const stock = Number(r.stock ?? 0) + Number(r.in_way_to_client ?? 0);
    const price = orders > 0 ? rev / orders : 0;          // Цена до СПП = ср. finished_price
    const buyoutPct = orders > 0 ? (r.buyouts_month / orders) * 100 : null;
    const drr = rev > 0 ? (ad / rev) * 100 : 0;
    const adPerUnit = orders > 0 ? ad / orders : 0;
    const commPct = commForNm(r.nm_id);
    const acqPct = acqForNm(r.nm_id);
    const commRub = price * commPct / 100;
    const acqRub = price * acqPct / 100;
    const taxRub = price * taxPct / 100;
    // Маржа ДО ДРР (без рекламы)
    const marginBeforeDrr = price - cost - ff - commRub - acqRub - taxRub;
    const marginBeforeDrrPct = price > 0 ? (marginBeforeDrr / price) * 100 : null;
    // Маржа/ед и вал % ПОСЛЕ ДРР (минус реклама)
    const marginUnit = marginBeforeDrr - adPerUnit;
    const valAfterDrrPct = price > 0 ? (marginUnit / price) * 100 : null;
    // Целевая цена до СПП для N% маржи: price = (cost+ff) / (1 − (comm+acq+tax+drr+margin)/100)
    const den = 1 - (commPct + acqPct + taxPct + drr + targetMargin) / 100;
    const targetPrice = den > 0 ? (cost + ff) / den : null;
    const deltaPct = targetPrice && price > 0 ? ((price - targetPrice) / targetPrice) * 100 : null;

    rows.push([
      "",                                   // 0 чекбокс
      "",                                   // 1 фото
      r.article || String(r.nm_id),         // 2 артикул (+ название под)
      m?.cat || "",                         // 3 категория
      r.nm_id,                              // 4 SKU → ссылка
      stock,                                // 5 Остаток + в пути
      r0(cost),                             // 6 Себес ₽
      blank(price > 0 ? r0(price) : null),  // 7 Цена до СПП ₽
      orders,                               // 8 Заказы/мес
      r0(rev),                              // 9 Выручка ₽
      buyoutPct != null ? r1(buyoutPct) : "", // 10 Выкуп %
      r1(commPct),                          // 11 Комиссия % (факт из отчёта)
      blank(price > 0 ? r0(commRub) : null),// 12 Комиссия ₽
      blank(price > 0 ? r0(acqRub) : null), // 13 Эквайринг ₽
      r0(ad),                               // 14 Реклама ₽
      r1(drr),                              // 15 ДРР %
      blank(price > 0 ? r0(taxRub) : null), // 16 Налог ₽
      blank(price > 0 ? r0(marginUnit) : null), // 17 Маржа/ед ₽
      marginBeforeDrrPct != null ? r1(marginBeforeDrrPct) : "", // 18 Маржа % до ДРР
      valAfterDrrPct != null ? r1(valAfterDrrPct) : "",          // 19 Вал % ПОСЛЕ ДРР
      targetPrice != null ? r0(targetPrice) : "",                // 20 Цена до СПП для N% маржи
      deltaPct != null ? r1(deltaPct) : "",                      // 21 Дельта %
    ]);
    img_urls.push(wbCardImageUrl(r.nm_id));
    names.push(m?.name || "");
  }

  return NextResponse.json({
    headers: [
      "", "", "Артикул", "Юрлицо", "SKU",
      "Остаток + в пути", "Себес ₽", "Цена до СПП ₽", "Заказы/мес", "Выручка ₽",
      "Выкуп %", "Комиссия %", "Комиссия ₽", "Эквайринг ₽", "Реклама ₽",
      "ДРР %", "Налог ₽", "Маржа/ед ₽", "Маржа % до ДРР", "Вал % ПОСЛЕ ДРР",
      `Цена до СПП для ${targetMargin}% маржи`, "Дельта %",
    ],
    rows,
    img_urls,
    names,
    source_url: null,
    meta_text: `Юнит по ${rows.length} SKU · комиссия ${comm.avgPct > 0 ? `${comm.avgPct}% факт` : `${commDefault}% дефолт`} · эквайринг ${comm.avgAcqPct > 0 ? `${comm.avgAcqPct}% факт` : `${acqDefault}% дефолт`} · налог ${taxPct}% · за 30 дней`,
  });
}
