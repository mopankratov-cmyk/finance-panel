import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import {
  WbFbwSupplyError,
  fetchFbwSupplyDetail,
  fetchFbwSupplyList,
  type FbwSupplyListRow,
} from "@/lib/wb/fbwSupplies";

// «Мои поставки» — история и статусы поставок на склады WB.
//
// Раздела не было вовсе: панель умела вести поставку до отправки (заказы
// фабрике, к поставке, приёмка), но не показывала, что с ней стало у WB.
//
// Склад приходит только в деталях поставки, а лимит у WB жёсткий — 30
// запросов в минуту на аккаунт. Поэтому детали дочитываются по счётчику для
// свежих строк, а у остальных склад честно пуст, а не выдуман.
export const maxDuration = 60;

/** Сколько поставок дочитываем деталями за один заход. */
const DETAIL_BUDGET = 12;

export interface WbSupplyRow extends FbwSupplyListRow {
  warehouse: string | null;
  quantity: number | null;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const raw = new URL(request.url).searchParams.get("cabinet");
  if (!raw || raw === "all" || raw.startsWith("group:")) {
    return NextResponse.json({ error: "Выберите один WB-кабинет: поставки живут в конкретном юрлице" }, { status: 400 });
  }
  const { cabinetId } = await resolveShopCabinet(raw);
  if (!cabinetId) return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 });
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });

  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 });
  // Тем же токеном ходит существующий разбор поставки по ссылке
  // (app/api/supplies/wb-supply-links): у supplies-api своя категория
  // «Поставки», но в нашей модели она живёт в основном ключе.
  const token = resolveWbToken(cabinet, "statistics");

  const deadline = Date.now() + 45_000;
  const warnings: string[] = [];

  let list: FbwSupplyListRow[];
  try {
    list = await fetchFbwSupplyList(token);
  } catch (error) {
    const message = error instanceof WbFbwSupplyError ? error.message : "Не удалось получить список поставок";
    return NextResponse.json({ error: message }, { status: error instanceof WbFbwSupplyError ? error.status : 502 });
  }

  // Свежие сверху: продавца интересует то, что едет сейчас.
  const sorted = [...list].sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));

  const rows: WbSupplyRow[] = sorted.map((row) => ({ ...row, warehouse: null, quantity: null }));
  const detailTargets = rows.filter((row) => row.supplyId !== null).slice(0, DETAIL_BUDGET);
  let detailed = 0;
  for (const row of detailTargets) {
    if (Date.now() > deadline) break;
    try {
      const detail = await fetchFbwSupplyDetail(token, row.supplyId!);
      row.warehouse = String(detail.warehouseName ?? detail.actualWarehouseName ?? "") || null;
      row.quantity = Number.isFinite(Number(detail.quantity)) ? Number(detail.quantity) : null;
      detailed += 1;
    } catch {
      // Деталь не пришла — оставляем пусто. Пустой склад честнее выдуманного.
    }
  }

  const withoutWarehouse = rows.filter((row) => row.supplyId !== null).length - detailed;
  if (withoutWarehouse > 0) {
    warnings.push(
      `Склад и количество дочитаны у ${detailed} поставок из ${rows.filter((r) => r.supplyId !== null).length}: `
      + `WB отдаёт их только по одной поставке за запрос при лимите 30 запросов в минуту. У остальных поля пусты — это «не спрашивали», а не «нет данных».`,
    );
  }

  return NextResponse.json({
    meta: { cabinetId, generatedAt: new Date().toISOString(), total: rows.length, warnings },
    data: { rows },
  });
}
