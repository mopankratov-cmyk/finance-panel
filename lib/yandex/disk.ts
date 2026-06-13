// Яндекс.Диск (публичная папка) как источник контента лаборатории.
// Публичный ключ = ссылка на расшаренную папку (YANDEX_PUBLIC_KEY). Без авторизации — только чтение.
const API = "https://cloud-api.yandex.net/v1/disk/public/resources";

function pk(): string | null {
  return process.env.YANDEX_PUBLIC_KEY || null;
}

export interface YaItem { name: string; path: string; type: "dir" | "file"; mime: string; isImage: boolean; preview?: string }

// Список содержимого папки по пути (path относительно публичного корня, напр. "/МАША").
export async function yaList(path = "/"): Promise<YaItem[]> {
  const key = pk();
  if (!key) return [];
  const url = `${API}?public_key=${encodeURIComponent(key)}&path=${encodeURIComponent(path)}&limit=500&fields=_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.items.mime_type,_embedded.items.preview`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), next: { revalidate: 600 } });
    if (!r.ok) return [];
    const j = (await r.json()) as { _embedded?: { items?: { name: string; path: string; type: string; mime_type?: string; preview?: string }[] } };
    return (j._embedded?.items ?? []).map((it) => {
      const p = it.path.replace(/^disk:/, "");
      const mime = it.mime_type ?? "";
      return { name: it.name, path: p, type: it.type === "dir" ? "dir" : "file", mime, isImage: mime.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(it.name), preview: it.preview };
    });
  } catch { return []; }
}

// Рекурсивно собрать изображения внутри папки (для подсчёта/галереи).
export async function yaCollectImages(path: string, depth = 2): Promise<YaItem[]> {
  const items = await yaList(path);
  const out: YaItem[] = items.filter((i) => i.type === "file" && i.isImage);
  if (depth > 0) for (const d of items.filter((i) => i.type === "dir")) out.push(...await yaCollectImages(d.path, depth - 1));
  return out;
}

// Прямая (временная) ссылка на скачивание файла по пути.
export async function yaDownloadHref(path: string): Promise<string | null> {
  const key = pk();
  if (!key) return null;
  try {
    const r = await fetch(`${API}/download?public_key=${encodeURIComponent(key)}&path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { href?: string };
    return j.href ?? null;
  } catch { return null; }
}
