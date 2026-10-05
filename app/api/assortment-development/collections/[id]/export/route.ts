import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { audit } from "@/lib/audit/log";
import { briefCsv, exportFileName } from "@/lib/assortment/collections";
import { collectionFailure, isUuid } from "@/lib/assortment/collectionsApi";
import { loadBrief } from "@/lib/assortment/collectionsStore";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Задание на образец из СОХРАНЁННОЙ версии подборки (ТЗ §8).
 * format=view — для страницы печати (с короткоживущими ссылками на фото);
 * json и csv — файлы на скачивание, без ссылок на хранилище.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Подборка не найдена" }, { status: 404 });
  const format = request.nextUrl.searchParams.get("format") ?? "view";
  const versionParam = Number(request.nextUrl.searchParams.get("version"));
  const version = Number.isInteger(versionParam) && versionParam > 0 ? versionParam : null;
  const session = await getServerSession();
  try {
    const brief = await loadBrief(db, id, version, format === "view");
    await audit(request, session, { action: "assortment.export", subject: `collection:${id}`, after: { format, version: brief.collection.version } });
    const name = exportFileName(brief.collection.period, brief.collection.version);
    if (format === "csv") {
      return new NextResponse(briefCsv(brief), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` },
      });
    }
    if (format === "json") {
      const { photos: _photos, ...snapshot } = brief;
      void _photos;
      return new NextResponse(JSON.stringify(snapshot, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.json"` },
      });
    }
    return NextResponse.json({ brief });
  } catch (error) {
    return collectionFailure(error);
  }
}
