import { NextRequest, NextResponse } from "next/server";
import { creatifyListAvatars, creatifyReady, CREATIFY_SCENES } from "@/lib/factory/creatify";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Галерея аватаров Creatify для пикера в кокпите. Read-only GET (бесплатно — не тратит кредиты).
// Это же первая live-проверка: если API недоступен на тарифе — вернём error+status, а не пустой список без причины.
// Фильтры через query: ?gender=f&age=adult&style=presenter&search=...&limit=120
export async function GET(req: NextRequest) {
  if (!creatifyReady()) {
    return NextResponse.json({ ready: false, avatars: [], scenes: CREATIFY_SCENES, detail: "Creatify не подключён: добавь CREATIFY_API_ID и CREATIFY_API_KEY в Vercel env" }, { status: 503 });
  }
  const sp = req.nextUrl.searchParams;
  const res = await creatifyListAvatars({
    gender: sp.get("gender") || undefined,
    age: sp.get("age") || undefined,
    style: sp.get("style") || undefined,
    location: sp.get("location") || undefined,
    search: sp.get("search") || undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });
  return NextResponse.json({
    ready: true,
    count: res.avatars.length,
    avatars: res.avatars,
    scenes: CREATIFY_SCENES,
    ...(res.error ? { error: res.error, status: res.status } : {}),
  });
}
