import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { loadAssortmentSources } from "@/lib/assortment/sources";

export const dynamic = "force-dynamic";

/** Паспорт источников раздела: что отслеживается и с каким доступом. */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;

  const raw = request.nextUrl.searchParams.get("direction");
  const direction = raw ? parseDirection(raw) : null;
  if (raw && !direction) {
    return NextResponse.json({ error: "direction должен быть jackets или bags" }, { status: 400 });
  }

  const result = await loadAssortmentSources(direction);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, reason: result.reason },
      { status: result.reason === "migration_missing" ? 503 : 500 },
    );
  }
  return NextResponse.json({ sources: result.sources });
}
