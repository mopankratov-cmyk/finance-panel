import { NextRequest, NextResponse } from "next/server";
import { resolveCabinetSelection } from "@/lib/cabinetGroups";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";

export const dynamic = "force-dynamic";

/** Схема фулфилмента — определяет, кто выводит КМ из оборота при продаже. */
export type MarkingScheme = "FBO" | "FBS";

/** Готовность кода к продаже по разрешительному режиму. */
export type MarkingPermission = "ok" | "warn" | "unknown";

/** Строка маркировки в разрезе SKU / поставки. */
export interface MarkingRow {
  nmId: number;
  article: string;
  /** Номер поставки WB (WB-GI-… или FBS-задание); "" — ещё не передана. */
  supply: string;
  scheme: MarkingScheme;
  /** Кодов введено в оборот. */
  introduced: number;
  /** Передано агенту (по УПД «Передача агенту», 00005). */
  atAgent: number;
  /** Выбыло из оборота (продано): FBO — WB сам, FBS — перед отправкой. */
  retired: number;
  /** Зависло: введено, но не выбыло и не в валидном статусе — требует действия. */
  stuck: number;
  permission: MarkingPermission;
}

export interface MarkingKpis {
  introduced: number;
  atAgent: number;
  retired: number;
  stuck: number;
}

export interface MarkingResponse {
  /** true после подключения токена Честного Знака для кабинета. */
  connected: boolean;
  kpis: MarkingKpis;
  rows: MarkingRow[];
  /** Время последней сверки статусов КМ (ISO) либо null. */
  syncedAt: string | null;
  error: string | null;
}

const EMPTY_KPIS: MarkingKpis = { introduced: 0, atAgent: 0, retired: 0, stuck: 0 };

export async function GET(req: NextRequest) {
  const { single, members } = await resolveCabinetSelection(new URL(req.url).searchParams.get("cabinet"));
  const accessAllowed = members
    ? (await Promise.all(members.map((member) => hasCabinetAccess(member)))).every(Boolean)
    : await hasCabinetAccess(single);
  if (!accessAllowed) {
    const denied: MarkingResponse = { connected: false, kpis: EMPTY_KPIS, rows: [], syncedAt: null, error: "Нет доступа к кабинету" };
    return NextResponse.json(denied, { status: 403 });
  }

  // Интеграция с Честным Знаком (True API) ещё не подключена — идёт отдельным PR:
  // модуль lib/crpt/ (авторизация по УКЭП, отдельный от WB токен ЧЗ) + сверочный
  // демон, раскладывающий статусы КМ по корзинам введено / у агента / выбыло / зависло.
  // Пока эндпоинт отдаёт пустой, но типизированный контракт, чтобы UI отрисовал каркас
  // и честное состояние «ЧЗ не подключён».
  const body: MarkingResponse = { connected: false, kpis: EMPTY_KPIS, rows: [], syncedAt: null, error: null };
  return NextResponse.json(body);
}
