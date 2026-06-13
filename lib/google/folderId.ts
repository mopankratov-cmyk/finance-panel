// Извлечь ID папки Google Drive из ссылки или вернуть как есть, если это уже ID.
export function parseFolderId(input: string): string {
  const s = (input || "").trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // голый id (без слешей/пробелов)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return s;
}
