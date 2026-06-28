import { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export async function isAuthorizedReelsBrainJobRequest(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return true;

  const header = req.headers.get("authorization") || "";
  if (header === `Bearer ${secret}`) return true;

  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(sessionToken);
  return session !== null;
}
