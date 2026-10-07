/**
 * Строка «Проверка» вкладки «Маржа по артикулам Ozon» — аналог строки 158
 * эталонной таблицы: итоги колонок маржи минус соответствующие строки
 * «Финансового отчёта Ozon» («К выплате»). Ноль — всё учтено. Не ноль — часть
 * начислений не попала ни на один артикул (строки без SKU) или не попала в
 * колонку (тип начисления, которого нет в раскладке).
 */
import type { OzonOpiuReport } from "./opiuOzonReport.ts";
import { OZON_SHEET_LOGISTICS_LINES, OZON_SHEET_OTHER_LINES } from "./opiuOzonSheetLayout.ts";
import { OZON_MARGIN_LOGISTICS_KEYS, type OzonMarginAccrualRow, type OzonMarginTotals } from "./marginBySku.ts";
import { OZON_SHEET_COMMISSION_TYPE_ID } from "./opiuOzonSheetLayout.ts";

export interface OzonMarginCheckCell {
  /** Ключ колонки таблицы маржи (netRub, commission, lastMile, …). */
  key: string;
  label: string;
  margin: number;
  report: number;
  /** margin − report; |diff| < 0.01 считается нулём. */
  diff: number;
  ok: boolean;
  /** Только у расходящихся колонок: объяснение причины простыми словами. */
  explanation?: string;
}

export interface OzonNewCharge {
  typeId: number;
  label: string;
  section: "logistics" | "other" | "ads";
  /** Сумма как расход (положительная) за выбранный период. */
  amount: number;
}

export interface OzonMarginCheck {
  cells: OzonMarginCheckCell[];
  ok: boolean;
  /**
   * Новые расходы и начисления Ozon: типы, которых нет в раскладке колонок
   * таблицы. В колонки маржи они не входят — их надо отнести к колонке вручную.
   */
  newCharges: OzonNewCharge[];
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const ruMoney = (value: number) =>
  `${value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
const NO_SKU = "-";

function cell(key: string, label: string, margin: number, report: number): OzonMarginCheckCell {
  const diff = round2(margin - report);
  return { key, label, margin: round2(margin), report: round2(report), diff, ok: Math.abs(diff) < 0.01 };
}

export function buildOzonMarginCheck(
  totals: OzonMarginTotals,
  report: OzonOpiuReport,
  accrualRows: OzonMarginAccrualRow[] = [],
): OzonMarginCheck {
  const section = (key: string) => report.sections.find((s) => s.key === key);
  const child = (sectionKey: string, childKey: string) =>
    section(sectionKey)?.children.find((c) => c.key === childKey)?.amount ?? 0;

  const cells: OzonMarginCheckCell[] = [
    cell("netRub", "Итого продаж, руб", totals.netRub, section("sales")?.amount ?? 0),
    cell("commission", "Комиссия", totals.commission, section("commission")?.amount ?? 0),
  ];
  const acquiringIndex = OZON_SHEET_OTHER_LINES.findIndex((line) => line.label === "Эквайринг");
  if (acquiringIndex >= 0) {
    // В отчёте «Прочие удержания» суммы со знаком начисления (расход < 0), в марже расход положительный.
    cells.push(cell("acquiring", "Эквайринг", totals.acquiring, -child("other", `other-${acquiringIndex}`)));
  }
  OZON_SHEET_LOGISTICS_LINES.forEach((line, i) => {
    cells.push(cell(OZON_MARGIN_LOGISTICS_KEYS[i], line.label, totals[OZON_MARGIN_LOGISTICS_KEYS[i]], -child("logistics", `logistics-${i}`)));
  });

  // Начисления без артикула — главная законная причина расхождения: в отчёте они есть,
  // а на артикул их повесить нельзя. Считаем их по каждой колонке отдельно.
  const typeIdsByKey = new Map<string, number[]>([
    ["commission", [OZON_SHEET_COMMISSION_TYPE_ID]],
    ["acquiring", OZON_SHEET_OTHER_LINES[acquiringIndex]?.typeIds ?? []],
  ]);
  OZON_SHEET_LOGISTICS_LINES.forEach((line, i) => typeIdsByKey.set(OZON_MARGIN_LOGISTICS_KEYS[i], line.typeIds));
  const noSku = accrualRows.filter((r) => r.sku === NO_SKU || !r.sku);
  for (const c of cells) {
    if (c.ok) continue;
    let amount = 0;
    let count = 0;
    if (c.key === "netRub") {
      for (const r of noSku) {
        if (r.type_id === OZON_SHEET_COMMISSION_TYPE_ID && Number(r.extra?.sale_amount ?? 0) !== 0) {
          amount += Number(r.extra?.sale_amount ?? 0);
          count++;
        }
      }
    } else {
      const ids = new Set(typeIdsByKey.get(c.key) ?? []);
      for (const r of noSku) {
        if (ids.has(r.type_id)) {
          amount -= Number(r.amount); // как расход
          count++;
        }
      }
    }
    amount = round2(amount);
    const head = `Колонка «${c.label}»: в марже ${ruMoney(c.margin)}, в финансовом отчёте ${ruMoney(c.report)} — не хватает ${ruMoney(Math.abs(c.diff))}.`;
    if (count > 0 && Math.abs(c.diff + amount) < 0.01) {
      c.explanation = `${head} Причина: ${count} начислен. без артикула на ${ruMoney(Math.abs(amount))} — Ozon не привязал их к товару, поэтому в маржу по артикулам они не попадают.`;
    } else if (count > 0) {
      c.explanation = `${head} Из них ${count} начислен. без артикула на ${ruMoney(Math.abs(amount))}; остальное ${ruMoney(Math.abs(c.diff + amount))} объяснить не удалось.`;
    } else {
      c.explanation = `${head} Начислений без артикула в этой колонке нет — причину установить не удалось, нужна ручная проверка.`;
    }
  }

  const newCharges: OzonNewCharge[] = [];
  for (const sectionKey of ["logistics", "other", "ads"] as const) {
    for (const c of section(sectionKey)?.children ?? []) {
      const match = /^type-(\d+)$/.exec(c.key);
      if (!match || !c.amount) continue;
      // logistics/other — суммы со знаком начисления (расход < 0); ads уже пересчитана в расход.
      newCharges.push({
        typeId: Number(match[1]),
        label: c.label,
        section: sectionKey,
        amount: round2(sectionKey === "ads" ? c.amount : -c.amount),
      });
    }
  }
  newCharges.sort((a, b) => a.typeId - b.typeId);

  return { cells, ok: cells.every((c) => c.ok), newCharges };
}
