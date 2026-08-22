// Расход кампании, который WB не разнёс по артикулам.
//
// fullstats отдаёт расход дважды: суммой за день по кампании (day.sum) и
// разбивкой по артикулам (day.apps[].nms[].sum). Вторая регулярно неполна —
// у части артикулов стоит 0 при живых показах, корзинах и заказах. Проверено
// на проде 22.08.2026 зондом sync-health?spend_split=1: кампания 38617401 за
// 22.08 потратила 569,74 ₽ на 12 артикулов, а разбивка отдала по нашему
// артикулу ноль. По кабинету так терялось около 5% расхода, а на отдельной
// карточке — весь: CPO и CPL по ней посчитать было не из чего.
//
// Остаток дня раскладывается по артикулам той же кампании пропорционально
// показам — это ближайшая к истине база, потому что списания у WB идут за
// показы (CPM) либо за клики внутри тех же показов. Клики — запасная база,
// поровну — последняя. Разложенная часть хранится ОТДЕЛЬНО от факта WB
// (spent_allocated), поэтому в любой момент видно, сколько в цифре измерено,
// а сколько восстановлено.

export interface SpendAllocationRow {
  /** Расход, который WB отдал прямо по этому артикулу. */
  spent: number;
  views: number;
  clicks: number;
}

/** Копейка: ниже неё остаток считаем шумом округления, а не потерей. */
const EPSILON = 0.01;

/**
 * Доли нераспределённого расхода по артикулам одной (кампании, дня).
 * Возвращает массив той же длины, что и rows.
 */
export function allocateCampaignSpend(rows: SpendAllocationRow[], campaignSpent: number): number[] {
  const zero = rows.map(() => 0);
  if (!rows.length || !Number.isFinite(campaignSpent) || campaignSpent <= 0) return zero;

  const measured = rows.reduce((sum, row) => sum + (Number.isFinite(row.spent) ? row.spent : 0), 0);
  const rest = campaignSpent - measured;
  // Разбивка полна (или WB отдал по артикулам БОЛЬШЕ, чем по кампании —
  // такое бывает при пересчётах; выдумывать отрицательный расход нельзя).
  if (rest <= EPSILON) return zero;

  const weightOf = (row: SpendAllocationRow, base: "views" | "clicks" | "even") => {
    if (base === "even") return 1;
    const value = row[base];
    return Number.isFinite(value) && value > 0 ? value : 0;
  };

  const base: "views" | "clicks" | "even" =
    rows.some((row) => weightOf(row, "views") > 0) ? "views"
      : rows.some((row) => weightOf(row, "clicks") > 0) ? "clicks"
        : "even";

  const weights = rows.map((row) => weightOf(row, base));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return zero;

  // Остаток от округления отдаём самой тяжёлой строке, иначе сумма долей не
  // сойдётся с расходом кампании и «недостача» вернулась бы через чёрный ход.
  const shares = weights.map((weight) => Math.round((rest * weight / total) * 100) / 100);
  const spread = shares.reduce((sum, share) => sum + share, 0);
  const drift = Math.round((rest - spread) * 100) / 100;
  if (drift !== 0) {
    let heaviest = 0;
    for (let index = 1; index < weights.length; index++) {
      if (weights[index] > weights[heaviest]) heaviest = index;
    }
    shares[heaviest] = Math.round((shares[heaviest] + drift) * 100) / 100;
  }
  return shares;
}
