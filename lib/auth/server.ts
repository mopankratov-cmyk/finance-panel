import { cookies } from "next/headers";
import { DEMO_MODE_ENABLED, DEMO_SESSION } from "./demoMode";
import { SESSION_COOKIE, verifySession, type Session } from "./session";

export async function getServerSession(): Promise<Session | null> {
  if (DEMO_MODE_ENABLED) return DEMO_SESSION;
  const c = await cookies();
  return verifySession(c.get(SESSION_COOKIE)?.value);
}
