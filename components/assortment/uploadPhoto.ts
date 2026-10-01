// Браузерная загрузка фото модуля: билет → PUT в приватное хранилище → путь.
// Тот же способ, что у файлов ДДС (components/payments/uploadViaStorage.ts).

export const PHOTO_ACCEPT = ["image/jpeg", "image/png", "image/webp"];
export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Отбор файлов: годные добавляются до лимита, остальные — с причиной. */
export function pickPhotos(current: File[], list: FileList | null): { files: File[]; rejected: string[] } {
  const files = [...current];
  const rejected: string[] = [];
  for (const file of Array.from(list ?? [])) {
    if (!PHOTO_ACCEPT.includes(file.type)) rejected.push(`${file.name}: нужен JPEG, PNG или WebP`);
    else if (file.size > MAX_PHOTO_BYTES) rejected.push(`${file.name}: больше 10 МБ`);
    else if (files.length < MAX_PHOTOS) files.push(file);
  }
  return { files, rejected };
}

export async function uploadPhoto(file: File): Promise<string> {
  const ticketResponse = await fetch("/api/assortment-development/upload-ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mime: file.type, size: file.size }),
  });
  const ticket = (await ticketResponse.json().catch(() => null)) as { path?: string; signedUrl?: string; error?: string } | null;
  if (!ticketResponse.ok || !ticket?.path || !ticket.signedUrl) throw new Error(ticket?.error ?? "Не удалось подготовить загрузку фото");
  const put = await fetch(ticket.signedUrl, { method: "PUT", headers: { "Content-Type": file.type, "x-upsert": "false" }, body: file });
  if (!put.ok) throw new Error(`Хранилище не приняло фото (${put.status})`);
  return ticket.path;
}
