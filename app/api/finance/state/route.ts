import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadFinanceStateServer, persistFinanceActionServer } from "@/lib/finance/dbServer";
import type { FinanceAction } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  try {
    return NextResponse.json(await loadFinanceStateServer());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить финансы" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  const body = await request.json().catch(() => null) as { action?: FinanceAction } | null;
  if (!body?.action) {
    return NextResponse.json({ error: "Некорректное финансовое действие" }, { status: 400 });
  }
  try {
    await persistFinanceActionServer(body.action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить финансы" }, { status: 500 });
  }
}
