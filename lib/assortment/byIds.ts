import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

/** Сколько id в одном `.in()`: сотни uuid в адресе запроса — это килобайты URL, шлюз может отказать. */
export const IDS_CHUNK = 100;

type Page<Row> = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

/**
 * Строки таблицы по списку id: пачками по IDS_CHUNK и с листанием ответа (предел PostgREST — 1000 строк на запрос; `.limit(5000)` его
 * не снимает). Сбой чтения — исключение, а не «данных нет»: пустой ответ вместо ошибки превращал бы сбой в ложный вывод.
 * В запросе нужен устойчивый порядок (по ключу), иначе листание может задвоить или потерять строки на границе страниц.
 */
export async function rowsByIds<Row>(ids: readonly string[], label: string, fetchPage: (part: string[], from: number, to: number) => Page<Row>): Promise<Row[]> {
  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_CHUNK) parts.push(ids.slice(i, i + IDS_CHUNK));
  const loaded = await Promise.all(parts.map((part) => loadAllSupabasePages<Row>((from, to) => fetchPage(part, from, to), { label, pageSize: 1000 })));
  return loaded.flat();
}
