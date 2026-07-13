import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";

export const dynamic = "force-dynamic";

// Триггер обновления юнит-данных (inferno кнопка). Источник держится свежим по Vercel cron,
// поэтому здесь подтверждаем актуальность; глубокий on-demand ре-синк цен/себеса (МойСклад) — отложен.
export async function POST(request: NextRequest) {
  const { cabinetId } = await resolveShopCabinet(new URL(request.url).searchParams.get("cabinet") ?? undefined);
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
