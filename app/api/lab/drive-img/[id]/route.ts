import { driveDownload } from "@/lib/google/drive";
import { proxyAuthorized } from "@/lib/auth/proxyAuth";

export const dynamic = "force-dynamic";

// Прокси изображения с Google Drive (файлы приватные — нужен токен сервис-аккаунта).
// Доступ: подпись (для будущей отдачи референсов Seedance) ИЛИ сессия (превью gfolder в браузере)
// ИЛИ cron — см. proxyAuthorized.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await proxyAuthorized(req))) return new Response("unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!id) return new Response("no id", { status: 400 });
  const file = await driveDownload(id);
  if (!file) return new Response("not found", { status: 404 });
  return new Response(file.buf, {
    headers: { "Content-Type": file.type, "Cache-Control": "public, max-age=86400" },
  });
}
