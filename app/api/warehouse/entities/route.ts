import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";

export type { LegalEntityRow } from "@/lib/warehouse/entityAccess";

export async function GET() {
  const gate = await requireApiSession();
  if (gate) return gate;
  const list = await listAccessibleEntities();
  if (!list.ok) return NextResponse.json({ data: null, error: list.error }, { status: list.status });
  return NextResponse.json({ data: list.rows, error: null });
}
