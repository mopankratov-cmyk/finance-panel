import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

/**
 * Артикул и остаток по номенклатуре — ровно то, и только то, что нужно таблице
 * кандидатов на экране CTR-тестов.
 *
 * Раньше эти два поля брались из `rnp_report` — агрегата, который считает
 * заказы и выкупы за сегодня, вчера, неделю и месяц, штуками и деньгами, плюс
 * рекламный расход. Кандидатам оттуда нужны `article` и `stock`; всё остальное
 * считалось и выбрасывалось. На кабинете «Оптима» это стоило 33 секунд и
 * заканчивалось `canceling statement due to statement timeout` — экран отдавал
 * 500 и пустую таблицу, то есть не работал вовсе на самом крупном кабинете.
 *
 * Соседи (`adverts/list`, `sklejki`, `supplies`) прячут тот же RPC за снимком
 * `loadCachedAdvertReportRows`, и этот путь напрашивался как самый дешёвый. Он
 * бы не помог: таймаут ставит СЕРВЕР БАЗЫ, а не бюджет роута, поэтому холодная
 * сборка снимка упиралась бы в него каждый раз и снимок не появился бы никогда.
 * Кэш спасает тех, у кого запрос успевает хотя бы однажды.
 *
 * Поэтому источник заменён, а не обёрнут: карточки и остатки читаются прямыми
 * выборками по `cabinet_id`. Остаток складывается по строкам склада — так же,
 * как это делает `addStockRow` в общем сборщике РНП: у одной номенклатуры
 * строка на каждый склад, и «остаток» это их сумма.
 */

export interface CtrCardRow {
  nm_id: number;
  article: string | null;
}

export interface CtrStockRow {
  nm_id: number;
  quantity: number | null;
}

export interface CtrProductTotal {
  nm_id: number;
  article: string;
  stock: number;
}

export function buildCtrProductTotals(cards: CtrCardRow[], stocks: CtrStockRow[]): CtrProductTotal[] {
  const stockByNm = new Map<number, number>();
  for (const row of stocks) {
    const nmId = Number(row.nm_id);
    if (!Number.isFinite(nmId)) continue;
    stockByNm.set(nmId, (stockByNm.get(nmId) ?? 0) + Number(row.quantity ?? 0));
  }

  const totals = new Map<number, CtrProductTotal>();
  for (const card of cards) {
    const nmId = Number(card.nm_id);
    if (!Number.isFinite(nmId)) continue;
    // Карточек на одну номенклатуру может прийти несколько (пересборка,
    // дубли синка). Артикул у них один и тот же, но пустой перезаписывать
    // непустым нельзя — иначе товар терял бы имя из-за порядка строк.
    const known = totals.get(nmId);
    const article = String(card.article ?? "").trim();
    if (known && !article) continue;
    totals.set(nmId, { nm_id: nmId, article: known?.article && !article ? known.article : article, stock: 0 });
  }

  // Остаток есть и у номенклатуры без карточки: карточку могли не синкнуть, а
  // товар на складе лежит и в рекламе крутится. Терять такую строку нельзя —
  // экран подставит номер вместо артикула и покажет её честно.
  for (const nmId of stockByNm.keys()) {
    if (!totals.has(nmId)) totals.set(nmId, { nm_id: nmId, article: "", stock: 0 });
  }

  for (const total of totals.values()) total.stock = stockByNm.get(total.nm_id) ?? 0;
  return [...totals.values()];
}

export async function loadCtrProductTotals(
  db: SupabaseClient,
  cabinetId: string,
  allowedNmIds: ReadonlySet<number> | null,
): Promise<CtrProductTotal[]> {
  // Пустой контур — это «ни одной номенклатуры», а не «все». Тот же приём, что
  // в справочнике категорий: у ограниченного пользователя пустой список не
  // должен открывать каталог соседа.
  if (allowedNmIds && allowedNmIds.size === 0) return [];
  const nmIds = allowedNmIds ? [...allowedNmIds] : null;

  const [cards, stocks] = await Promise.all([
    loadAllSupabasePages<CtrCardRow>((from, to) => {
      const query = db
        .from("wb_cards")
        .select("nm_id, article")
        .eq("cabinet_id", cabinetId)
        .order("nm_id", { ascending: true })
        .range(from, to);
      return nmIds ? query.in("nm_id", nmIds) : query;
    }, { label: "CTR-тест: карточки WB" }),
    loadAllSupabasePages<CtrStockRow>((from, to) => {
      const query = db
        .from("wb_stocks")
        .select("nm_id, quantity")
        .eq("cabinet_id", cabinetId)
        .order("nm_id", { ascending: true })
        .range(from, to);
      return nmIds ? query.in("nm_id", nmIds) : query;
    }, { label: "CTR-тест: остатки WB" }),
  ]);

  return buildCtrProductTotals(cards, stocks);
}
