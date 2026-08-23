import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { loadKizSettings, saveKizSettings } from "@/lib/wb/kizSettings";
import { getServerSession } from "@/lib/auth/server";

// Настройки сверки Честного Знака: какие предметы владелец пометил как
// немаркируемые и не отказался ли он от раздела целиком.
//
// Автоматика (WB сам перечисляет допустимые идентификаторы задания) закрывает
// большинство случаев, но не все: часть заданий приходит без метаданных. Тогда
// решает человек — и его решение должно пережить перезагрузку страницы.

async function resolveCabinet(request: NextRequest) {
  const raw = new URL(request.url).searchParams.get("cabinet");
  if (!raw || raw === "all" || raw.startsWith("group:")) return { error: "Выберите один WB-кабинет", status: 400 as const };
  const { cabinetId } = await resolveShopCabinet(raw);
  if (!cabinetId) return { error: "Кабинет не найден", status: 404 as const };
  if (!(await hasCabinetAccess(cabinetId))) return { error: "Нет доступа к кабинету", status: 403 as const };
  return { cabinetId };
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const resolved = await resolveCabinet(request);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  return NextResponse.json({ data: await loadKizSettings(resolved.cabinetId) });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const resolved = await resolveCabinet(request);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  let body: { hideSubject?: unknown; showSubject?: unknown; notApplicable?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ожидается JSON" }, { status: 400 });
  }

  const current = await loadKizSettings(resolved.cabinetId);
  let hidden = current.hiddenSubjects;

  if (typeof body.hideSubject === "string" && body.hideSubject.trim()) {
    hidden = [...hidden, body.hideSubject.trim()];
  }
  if (typeof body.showSubject === "string" && body.showSubject.trim()) {
    const key = body.showSubject.trim().toLocaleLowerCase("ru-RU");
    hidden = hidden.filter((item) => item.trim().toLocaleLowerCase("ru-RU") !== key);
  }

  const session = await getServerSession().catch(() => null);
  try {
    const saved = await saveKizSettings(
      resolved.cabinetId,
      {
        hiddenSubjects: hidden,
        ...(typeof body.notApplicable === "boolean" ? { notApplicable: body.notApplicable } : {}),
      },
      session?.email ?? null,
    );
    return NextResponse.json({ data: saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось сохранить настройку" },
      { status: 500 },
    );
  }
}
