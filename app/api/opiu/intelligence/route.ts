import { NextResponse } from "next/server";
import { analyzeFinances } from "@/lib/opiu/financialIntelligence";
import type { Account, Payment } from "@/lib/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json() as { accounts?: Account[]; payments?: Payment[]; today?: string };
    if (!Array.isArray(body.accounts) || !Array.isArray(body.payments)) {
      return NextResponse.json({ error: "Нужны массивы accounts и payments" }, { status: 400 });
    }
    return NextResponse.json(analyzeFinances({
      accounts: body.accounts,
      payments: body.payments,
      today: body.today,
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось провести финансовый анализ" },
      { status: 500 },
    );
  }
}
