import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { cabinetRights } from "@/lib/auth/cabinetLevel";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";

// Что текущий сотрудник может в этом кабинете.
//
// Интерфейсу нужно знать уровень, чтобы не прятать кнопки у того, кому права
// выдали, и не показывать их тому, у кого их нет. Решение всё равно принимает
// сервер при записи — здесь только подсказка для отрисовки.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const cabinetId = cabinetIdFromParam(new URL(request.url).searchParams.get("cabinet"));
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  const rights = await cabinetRights(cabinetId);
  return NextResponse.json({
    canAnnotate: rights.canAnnotate,
    canOperate: rights.canOperate,
    level: rights.level,
    source: rights.source,
  });
}
