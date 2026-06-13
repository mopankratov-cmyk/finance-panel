import { driveDownload } from "@/lib/google/drive";

export const dynamic = "force-dynamic";

// Прокси изображения с Google Drive (файлы приватные — нужен токен сервис-аккаунта).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return new Response("no id", { status: 400 });
  const file = await driveDownload(id);
  if (!file) return new Response("not found", { status: 404 });
  return new Response(file.buf, {
    headers: { "Content-Type": file.type, "Cache-Control": "public, max-age=86400" },
  });
}
