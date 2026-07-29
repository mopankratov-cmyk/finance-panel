interface SupabasePage<Row> {
  data: Row[] | null;
  error: { message: string } | null;
}

interface LoadAllPagesOptions {
  pageSize?: number;
  maxPages?: number;
  label?: string;
}

export async function loadAllSupabasePages<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<SupabasePage<Row>>,
  options: LoadAllPagesOptions = {},
): Promise<Row[]> {
  const pageSize = options.pageSize ?? 1000;
  const maxPages = options.maxPages ?? 30;
  const label = options.label ?? "Запрос";
  const rows: Row[] = [];

  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(page * pageSize, page * pageSize + pageSize - 1);
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }

  throw new Error(`${label} превысил безопасный лимит ${pageSize * maxPages} строк`);
}
