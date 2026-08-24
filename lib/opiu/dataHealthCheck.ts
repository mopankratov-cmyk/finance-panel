import type { OpiuReport } from "./buildReport";

export interface HealthCheckIssue {
  id: string;
  label: string;
  saleDateTotal: number;
  reportDateTotal: number;
  diffAbs: number;
  diffPct: number;
}

/**
 * Оба свода ("по дате продажи" и "по дате отчёта") строятся по одному и тому же
 * набору строк финотчёта — просто группируют их по разным датам (sale_dt vs rr_dt).
 * Итог за месяц (последняя колонка "Итого") у обоих должен совпадать почти точно —
 * расхождение по конкретной неделе ожидаемо (строки сдвигаются между неделями),
 * а вот расхождение ИТОГОВ за весь месяц означает, что где-то реально разные
 * наборы строк — синк неполный, потерялись данные, или разъехалась логика.
 *
 * Заменяет ручную сверку выгрузок в Excel — оба свода уже загружены на каждый
 * визит страницы, сравнение ничего не стоит и работает всегда, без миграций
 * и ручных действий.
 */
export function checkReportConsistency(
  bySaleDate: OpiuReport,
  byReportDate: OpiuReport,
  thresholdPct = 2,
): HealthCheckIssue[] {
  const byReportDateRows = new Map(byReportDate.rows.map((row) => [row.id, row]));
  const issues: HealthCheckIssue[] = [];

  for (const row of bySaleDate.rows) {
    if (row.kind !== "metric") continue;
    const other = byReportDateRows.get(row.id);
    if (!other) continue;

    const saleDateTotal = row.values.at(-1) ?? null;
    const reportDateTotal = other.values.at(-1) ?? null;
    if (saleDateTotal === null || reportDateTotal === null) continue;

    const scale = Math.max(Math.abs(saleDateTotal), Math.abs(reportDateTotal), 1);
    const diffAbs = Math.abs(saleDateTotal - reportDateTotal);
    const diffPct = (diffAbs / scale) * 100;
    if (diffPct > thresholdPct) {
      issues.push({
        id: row.id,
        label: row.label,
        saleDateTotal,
        reportDateTotal,
        diffAbs,
        diffPct,
      });
    }
  }

  return issues.sort((a, b) => b.diffAbs - a.diffAbs);
}
