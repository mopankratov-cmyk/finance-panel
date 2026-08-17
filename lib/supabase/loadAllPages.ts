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
}

export async function loadAllSupabasePages<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<SupabasePage<Row>>,
  options: LoadAllPagesOptions = {},
): Promise<Row[]> {
  const pageSize = options.pageSize ?? 1000;
  const maxPages = options.maxPages ?? 30;
  const label = options.label ?? "Запрос";
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const rows: Row[] = [];

  for (let page = 0; page < maxPages; page += concurrency) {
    const batchCount = Math.min(concurrency, maxPages - page);
    const results = await Promise.all(Array.from({ length: batchCount }, (_, index) => {
      const from = (page + index) * pageSize;
      return fetchPage(from, from + pageSize - 1);
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
