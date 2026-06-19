// Яндекс.Диск (публичные папки) как источник реального контента завода.
// Публичный ключ = ссылка на расшаренную папку (или env YANDEX_PUBLIC_KEY как дефолт).
// Поддержка НЕСКОЛЬКИХ дисков: ключ можно передать в каждый вызов. Без авторизации — только чтение.
const API = "https://cloud-api.yandex.net/v1/disk/public/resources";

function pk(key?: string): string | null {
  return (key && key.trim()) || process.env.YANDEX_PUBLIC_KEY || null;
}

export interface YaItem { name: string; path: string; type: "dir" | "file"; mime: string; isImage: boolean; isVideo: boolean; preview?: string }

// Список содержимого папки по пути (path относительно публичного корня, напр. "/МАША").
export async function yaList(path = "/", key?: string): Promise<YaItem[]> {
  const k = pk(key);
  if (!k) return [];
  const url = `${API}?public_key=${encodeURIComponent(k)}&path=${encodeURIComponent(path)}&limit=500&fields=_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.items.mime_type,_embedded.items.preview`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), next: { revalidate: 600 } });
    if (!r.ok) return [];
    const j = (await r.json()) as { _embedded?: { items?: { name: string; path: string; type: string; mime_type?: string; preview?: string }[] } };
    return (j._embedded?.items ?? []).map((it) => {
      const p = it.path.replace(/^disk:/, "");
      const mime = it.mime_type ?? "";
      const isImage = mime.startsWith("image/") || /\.(png|jpe?g|webp|heic)$/i.test(it.name);
      const isVideo = mime.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(it.name);
      return { name: it.name, path: p, type: it.type === "dir" ? "dir" : "file", mime, isImage, isVideo, preview: it.preview };
    });
  } catch { return []; }
}

// Рекурсивно собрать изображения внутри папки (для подсчёта/галереи/подбора фото).
export async function yaCollectImages(path: string, depth = 2, key?: string): Promise<YaItem[]> {
  const items = await yaList(path, key);
  const out: YaItem[] = items.filter((i) => i.type === "file" && i.isImage);
  if (depth > 0) for (const d of items.filter((i) => i.type === "dir")) out.push(...await yaCollectImages(d.path, depth - 1, key));
  return out;
}

// Рекурсивно собрать видео внутри папки (для нарезки в риллсы).
export async function yaCollectVideos(path: string, depth = 2, key?: string): Promise<YaItem[]> {
  const items = await yaList(path, key);
  const out: YaItem[] = items.filter((i) => i.type === "file" && i.isVideo);
  if (depth > 0) for (const d of items.filter((i) => i.type === "dir")) out.push(...await yaCollectVideos(d.path, depth - 1, key));
  return out;
}

// Прямая (временная) ссылка на скачивание файла по пути.
export async function yaDownloadHref(path: string, key?: string): Promise<string | null> {
  const k = pk(key);
  if (!k) return null;
  try {
    const r = await fetch(`${API}/download?public_key=${encodeURIComponent(k)}&path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { href?: string };
    return j.href ?? null;
  } catch { return null; }
}
