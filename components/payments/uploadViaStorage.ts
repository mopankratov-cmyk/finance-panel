// Браузерная сторона прямой загрузки: билет → PUT в хранилище → путь объекта.
// Файлы меньше порога идут как раньше, multipart в наш роут.

export const DIRECT_UPLOAD_THRESHOLD_BYTES = 3_500_000;

export function needsDirectUpload(file: File): boolean {
  return file.size > DIRECT_UPLOAD_THRESHOLD_BYTES;
}

export async function uploadViaStorage(file: File): Promise<string> {
  const ticketResponse = await fetch("/api/opiu/upload-ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, size: file.size }),
  });
  const ticket = await ticketResponse.json().catch(() => null) as { path?: string; signedUrl?: string; error?: string } | null;
  if (!ticketResponse.ok || !ticket?.path || !ticket.signedUrl) throw new Error(ticket?.error ?? "Не удалось получить ссылку на загрузку");
  const put = await fetch(ticket.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
    body: file,
  });
  if (!put.ok) {
    const text = await put.text().catch(() => "");
    throw new Error(`Хранилище не приняло файл (${put.status})${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  return ticket.path;
}
