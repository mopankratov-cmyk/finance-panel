import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { allowedUgcProducts } from "@/lib/ugc/product";
import { UGC_AVATARS } from "@/lib/ugc/validation";
import { productReadiness } from "@/lib/wb/productReadiness";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const cabinetId = cabinetIdFromParam(new URL(request.url).searchParams.get("cabinet"));
  if (!cabinetId) return NextResponse.json({ ok: false, error: "Выберите один реальный WB-кабинет" }, { status: 400 });
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ ok: false, error: "Нет доступа к кабинету" }, { status: 403 });
  try {
    const rows = await allowedUgcProducts(cabinetId);
    return NextResponse.json({ ok: true, cabinetId, avatars: UGC_AVATARS.map(({ prompt: _prompt, ...avatar }) => avatar), products: rows.map((row) => ({
      nmId: row.nmId,
      article: row.article,
      name: row.name,
      brand: row.brand,
      subject: row.subject,
      photos: row.photos,
      photosCount: row.photosCount,
      hasVideo: row.hasVideo,
      contentScore: productReadiness(row).score,
    })) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не удалось загрузить каталог UGC" }, { status: 502 });
  }
}
