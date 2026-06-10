import { NextRequest, NextResponse } from "next/server";
import { saveWarehouseCost } from "@/lib/opiu/loadMonth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      month?: string;
      weekStart?: string;
      amount?: number;
    };

    const { month, weekStart, amount } = body;
    if (!month || !weekStart || amount == null || !Number.isFinite(amount)) {
      return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
    }

    await saveWarehouseCost(month, weekStart, amount);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ошибка сохранения";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
