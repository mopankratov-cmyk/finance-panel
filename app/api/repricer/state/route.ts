import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadStrategies } from "@/lib/repricer/run";

export const dynamic = "force-dynamic";

// GET — список стратегий репрайсера.
export async function GET() {
  const gate = await requireApiSession();
  if (gate) return gate;
  const strategies = await loadStrategies();
  return NextResponse.json({ strategies, count: strategies.length });
}
