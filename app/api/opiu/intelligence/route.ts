import { NextResponse } from "next/server";
import { analyzeFinances } from "@/lib/opiu/financialIntelligence";
import { loadFinanceStateServer } from "@/lib/finance/dbServer";
import type { Account, Payment } from "@/lib/types";
import { requireApiSession } from "@/lib/auth/apiGuard";

export const maxDuration = 60;

export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  try {
    const body = await request.json().catch(() => null) as { accounts?: Account[]; payments?: Payment[]; today?: string } | null;
    const state = Array.isArray(body?.accounts) && Array.isArray(body?.payments)
      ? { accounts: body.accounts, payments: body.payments }
      : await loadFinanceStateServer();
    const today = body?.today ?? new URL(request.url).searchParams.get("today") ?? undefined;
    return NextResponse.json(analyzeFinances({
      accounts: state.accounts,
      payments: state.payments,
      today,
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось провести финансовый анализ" },
      { status: 500 },
    );
  }
}
