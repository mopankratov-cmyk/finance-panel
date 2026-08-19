interface SupabasePage<Row> {
  data: Row[] | null;
  error: { message: string } | null;
}

interface LoadAllPagesOptions {
  pageSize?: number;
  maxPages?: number;
  label?: string;
  /**
   * Сколько страниц запрашивать одновременно. По умолчанию 1 — прежнее
   * последовательное листание. Большие выборки (десятки страниц) с
   * concurrency > 1 читаются пачками: каждый round-trip к БД ~100–300 мс,
   * и последовательное листание складывает их в секунды. Порядок строк
   * сохраняется — пачка склеивается по номерам страниц.
   */
  concurrency?: number;
  /**
   * Сколько раз повторить страницу при временной ошибке базы. По умолчанию 2.
   * Под нагрузкой Postgres обрывает тяжёлый RPC по statement timeout — раньше
   * первая же такая ошибка роняла весь экран («Источник не успел ответить»),
   * хотя повтор через долю секунды проходит. Повторяем только временные сбои:
   * ошибка в самом запросе (нет прав, кривой аргумент) должна падать сразу.
   */
  retries?: number;
}

/** Временный сбой базы: имеет смысл повторить. Список — как в lib/rnp/buildTable.ts. */
function isRetryableDbError(message: string): boolean {
  return /fetch failed|statement timeout|timed out|timeout|connection/i.test(message);
}

export async function loadAllSupabasePages<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<SupabasePage<Row>>,
  options: LoadAllPagesOptions = {},
): Promise<Row[]> {
  const pageSize = options.pageSize ?? 1000;
  const maxPages = options.maxPages ?? 30;
  const label = options.label ?? "Запрос";
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const retries = Math.max(0, Math.floor(options.retries ?? 2));
  const rows: Row[] = [];

  // Страница с повтором на временных сбоях базы. Пауза растёт линейно —
  // этого хватает, чтобы разойтись с пиком нагрузки, и не съедает бюджет роута.
  const fetchPageWithRetry = async (from: number, to: number): Promise<SupabasePage<Row>> => {
    let result = await fetchPage(from, to);
    for (let attempt = 0; attempt < retries; attempt++) {
      if (!result.error || !isRetryableDbError(result.error.message)) return result;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      result = await fetchPage(from, to);
    }
    return result;
  };

  for (let page = 0; page < maxPages; page += concurrency) {
    const batchCount = Math.min(concurrency, maxPages - page);
    const results = await Promise.all(Array.from({ length: batchCount }, (_, index) => {
      const from = (page + index) * pageSize;
      return fetchPageWithRetry(from, from + pageSize - 1);
    }));
    for (const result of results) {
      if (result.error) throw new Error(`${label}: ${result.error.message}`);
      const batch = result.data ?? [];
      rows.push(...batch);
      // Короткая страница = конец выборки; страницы за ней в этой пачке пусты.
      if (batch.length < pageSize) return rows;
    }
  }

  throw new Error(`${label} превысил безопасный лимит ${pageSize * maxPages} строк`);
}
