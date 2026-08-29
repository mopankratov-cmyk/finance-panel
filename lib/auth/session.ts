import { SignJWT, jwtVerify } from "jose";

export type Role = "director" | "finance" | "manager" | "ozon_manager" | "seller" | "warehouse";
export interface Session {
  uid: string;
  email: string;
  role: Role;
  cabinet_ids: string[];
  organization_id: string | null;
}

export const SESSION_COOKIE = "fp_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 дней

function secret(): Uint8Array {
  const configured = process.env.AUTH_SECRET;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET обязателен в production");
  }
  const s = configured || "dev-insecure-secret-change-me-finance-panel";
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
    if (!payload.email || !isRole(payload.role)) return null;
    return {
      uid: String(payload.uid ?? ""),
      email: String(payload.email),
      role: payload.role,
      cabinet_ids: Array.isArray(payload.cabinet_ids) ? (payload.cabinet_ids as string[]) : [],
      organization_id: typeof payload.organization_id === "string" && payload.organization_id
        ? payload.organization_id
        : null,
    };
  } catch {
    return null;
  }
}

export function isRole(value: unknown): value is Role {
  return value === "director" || value === "finance" || value === "manager"
    || value === "ozon_manager" || value === "seller" || value === "warehouse";
}

export const sessionCookieOptions = {
  httpOnly: true as const,
  secure: true as const,
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
};
