import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { pollUgcTask, verifyUgcTask } from "@/lib/ugc/task";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = await request.json().catch(() => ({})) as { token?: unknown };
  const task = await verifyUgcTask(String(body.token ?? ""));
  if (!task) return NextResponse.json({ ok: false, error: "Задача генерации повреждена или истекла" }, { status: 400 });
  if (!(await hasCabinetAccess(task.cabinetId))) return NextResponse.json({ ok: false, error: "Нет доступа к кабинету задачи" }, { status: 403 });
  const allowedNmIds = await requestAllowedNmIds(task.cabinetId);
  if (allowedNmIds !== null && !allowedNmIds.has(task.nmId)) return NextResponse.json({ ok: false, error: "Задача вне товарного контура кабинета" }, { status: 403 });
  const status = await pollUgcTask(task);
  return NextResponse.json({ ok: true, task: { ...task, ...status } });
}
