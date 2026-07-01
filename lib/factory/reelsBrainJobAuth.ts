import { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export async function isAuthorizedReelsBrainJobRequest(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) {
    // fail-closed: без CRON_SECRET все job-роуты закрыты, а не открыты для всех
    console.error("[reelsBrainJobAuth] CRON_SECRET не задан — запрос отклонён (fail-closed). Задайте CRON_SECRET в окружении.");
    return false;
  }

  const header = req.headers.get("authorization") || "";
  if (header === `Bearer ${secret}`) return true;

  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(sessionToken);
  return session !== null;
}
