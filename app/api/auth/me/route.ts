import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getServerSession();
  if (!s) return NextResponse.json({ user: null });
  return NextResponse.json({ user: { email: s.email, role: s.role, cabinet_ids: s.cabinet_ids } });
}
