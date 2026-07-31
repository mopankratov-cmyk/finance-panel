import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadFinanceStateServer, persistFinanceActionServer } from "@/lib/finance/dbServer";
import type { FinanceAction, FinanceState } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  try {
    return NextResponse.json(await loadFinanceStateServer());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить финансы" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const body = await request.json().catch(() => null) as { action?: FinanceAction; prevState?: FinanceState; nextState?: FinanceState } | null;
  if (!body?.action || !body.prevState || !body.nextState) {
    return NextResponse.json({ error: "Некорректное финансовое действие" }, { status: 400 });
  }
  try {
    await persistFinanceActionServer(body.action, body.prevState, body.nextState);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить финансы" }, { status: 500 });
  }
}
