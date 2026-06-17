import { NextRequest, NextResponse } from "next/server";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchWbCatalogPrices, WbPriceScopeError, type WbPrice } from "@/lib/wb/prices";
import { buildXlsx } from "@/lib/xlsx/write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Экспорт XLSX «Новые цены» (±5/10%) для отмеченных SKU.
// Тело: { action: "up5"|"down5"|"up10"|"down10", nms: number[], cabs: {<nm>: "имя кабинета"} }.
// Текущая каталожная цена — из официального Discounts-Prices API (по токену кабинета SKU).
// Отдаём .xlsx + заголовки X-Price-Found / X-Price-Missing (как ждёт UI).

const FACTORS: Record<string, { f: number; label: string }> = {
  up5: { f: 1.05, label: "+5%" },
  down5: { f: 0.95, label: "−5%" },
  up10: { f: 1.1, label: "+10%" },
  down10: { f: 0.9, label: "−10%" },
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { action?: string; nms?: number[]; cabs?: Record<string, string> }
    | null;
  const action = body?.action ?? "";
  const fx = FACTORS[action];
  if (!fx) return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  const nms = (body?.nms ?? []).map(Number).filter(Boolean);
  if (!nms.length) return NextResponse.json({ error: "Не переданы SKU" }, { status: 400 });
  const cabs = body?.cabs ?? {};

  const cabinets = await getActiveWbCabinets();
  const cabById = new Map(cabinets.map((c) => [c.id, c]));
  const tokenByName = new Map(cabinets.map((c) => [c.name, c.token]));

  // надёжная привязка SKU→кабинет: из БД по cabinet_id (а не по строке из UI, которая в режиме «Все» = «Магазин»)
  const cabIdByNm = new Map<number, string>();
  const db = getSupabaseAdmin();
  if (db) {
    for (const table of ["wb_stocks", "wb_orders"]) {
      const remaining = nms.filter((n) => !cabIdByNm.has(n));
      if (!remaining.length) break;
      const { data } = await db.from(table).select("nm_id, cabinet_id").in("nm_id", remaining).not("cabinet_id", "is", null);
      for (const r of (data ?? []) as { nm_id: number; cabinet_id: string }[]) {
        if (!cabIdByNm.has(Number(r.nm_id))) cabIdByNm.set(Number(r.nm_id), r.cabinet_id);
      }
    }
  }

  // группируем nm по токену кабинета: сперва БД, затем имя-подсказка из UI (cabs)
  const nmsByToken = new Map<string, { token: string; cabName: string; nms: number[] }>();
  const unresolved: number[] = [];
  for (const nm of nms) {
    let token: string | undefined;
    let cabName = "";
    const cid = cabIdByNm.get(nm);
    const c = cid ? cabById.get(cid) : undefined;
    if (c) { token = c.token; cabName = c.name; }
    else {
      const hint = cabs[String(nm)] || "";
      const t = tokenByName.get(hint);
      if (t) { token = t; cabName = hint; }
    }
    if (!token) { unresolved.push(nm); continue; }
    const e = nmsByToken.get(token) ?? { token, cabName, nms: [] };
    e.nms.push(nm);
    nmsByToken.set(token, e);
  }

  // тянем цены по каждому кабинету; ошибки скоупа копим отдельно
  const priceByNm = new Map<number, WbPrice & { cab: string }>();
  const scopeFailedCabs = new Set<string>();
  await Promise.all(
    [...nmsByToken.values()].map(async (g) => {
      try {
        const map = await fetchWbCatalogPrices(g.token, new Set(g.nms));
        for (const nm of g.nms) {
          const p = map.get(nm);
          if (p && p.price > 0) priceByNm.set(nm, { ...p, cab: g.cabName });
        }
      } catch (e) {
        if (e instanceof WbPriceScopeError) scopeFailedCabs.add(g.cabName);
      }
    }),
  );

  // строки файла в порядке исходного выбора
  const header = ["Артикул WB (nmID)", "Артикул продавца", "Кабинет", "Текущая цена, ₽", `Новая цена (${fx.label}), ₽`, "Скидка, %"];
  const rows: (string | number)[][] = [header];
  let found = 0;
  let missing = 0;
  for (const nm of nms) {
    const p = priceByNm.get(nm);
    if (!p) { missing++; continue; }
    const newPrice = Math.round(p.price * fx.f);
    rows.push([nm, p.vendorCode || "", p.cab, Math.round(p.price), newPrice, p.discount]);
    found++;
  }

  // совсем нет цен и единственная причина — отсутствие скоупа: понятная ошибка
  if (found === 0 && scopeFailedCabs.size > 0) {
    return NextResponse.json(
      { error: `Нет доступа к ценам у кабинетов: ${[...scopeFailedCabs].join(", ")}. Перевыпустите токен со скоупом «Цены и скидки».` },
      { status: 403 },
    );
  }
  if (found === 0) {
    return NextResponse.json({ error: "Не нашёл текущих цен для выбранных SKU" }, { status: 404 });
  }

  const xlsx = buildXlsx("Новые цены", rows);
  const note = scopeFailedCabs.size ? `нет доступа к ценам: ${[...scopeFailedCabs].join(", ")}` : "";
  const fname = `Новые_цены_${fx.label.replace("−", "-")}.xlsx`;
  return new Response(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="prices.xlsx"; filename*=utf-8''${encodeURIComponent(fname)}`,
      "X-Price-Found": String(found),
      "X-Price-Missing": String(missing + unresolved.length),
      ...(note ? { "X-Price-Note": encodeURIComponent(note) } : {}),
    },
  });
}
