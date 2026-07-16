import { SignJWT, jwtVerify } from "jose";

export type Role = "director" | "finance" | "manager";
export interface Session {
  uid: string;
  email: string;
  role: Role;
  cabinet_ids: string[];
}

export const SESSION_COOKIE = "fp_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 дней

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET || "dev-insecure-secret-change-me-finance-panel";
  return new TextEncoder().encode(s);
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.email || !payload.role) return null;
    return {
      uid: String(payload.uid ?? ""),
      email: String(payload.email),
      role: payload.role as Role,
      cabinet_ids: Array.isArray(payload.cabinet_ids) ? (payload.cabinet_ids as string[]) : [],
    };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
};
