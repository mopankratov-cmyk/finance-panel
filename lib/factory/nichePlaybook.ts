// §17 Ф2 · извлечение JSON-плейбука из строки БД niche_playbooks (select("playbook,updated_at")).
// Контракт: грундинг (buildGrounding и т.п.) ждёт САМ плейбук ({winning_formats, anti_patterns, ...}),
// а не строку-обёртку {playbook, updated_at} — передача строки молча зануляет winning_formats/анти-паттерны.
export function playbookFromRow(row: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const pb = row?.playbook;
  return pb && typeof pb === "object" && !Array.isArray(pb) ? (pb as Record<string, unknown>) : null;
}
