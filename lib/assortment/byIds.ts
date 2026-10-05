import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

/** Сколько id в одном `.in()`: сотни uuid в адресе запроса — это килобайты URL, шлюз может отказать. */
export const IDS_CHUNK = 100;

/** Сколько пачек читается одновременно: на 10 000 id это 100 пачек, и все разом — сотня запросов к базе в один миг. */
export const IDS_CONCURRENCY = 4;

type Page<Row> = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

/**
 * Строки таблицы по списку id: пачками по IDS_CHUNK и с листанием ответа (предел PostgREST — 1000 строк на запрос; `.limit(5000)` его
 * не снимает). Сбой чтения — исключение, а не «данных нет»: пустой ответ вместо ошибки превращал бы сбой в ложный вывод.
 * В запросе нужен устойчивый порядок (по ключу), иначе листание может задвоить или потерять строки на границе страниц.
 */
export async function rowsByIds<Row>(ids: readonly string[], label: string, fetchPage: (part: string[], from: number, to: number) => Page<Row>): Promise<Row[]> {
  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_CHUNK) parts.push(ids.slice(i, i + IDS_CHUNK));
  // Пул из IDS_CONCURRENCY читателей: порядок результата — по номеру пачки, как и при «все сразу»; после первого сбоя новые пачки не берём.
  const loaded: Row[][] = new Array(parts.length);
  let next = 0;
  let aborted = false;
  const worker = async () => {
    while (!aborted) {
      const index = next++;
      if (index >= parts.length) return;
      try {
        loaded[index] = await loadAllSupabasePages<Row>((from, to) => fetchPage(parts[index], from, to), { label, pageSize: 1000 });
      } catch (error) {
        aborted = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(IDS_CONCURRENCY, parts.length) }, worker));
  return loaded.flat();
}
