import { NextRequest, NextResponse } from "next/server";
import { parseShelfSnapshotPayload } from "@/lib/shelf/ingest";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkShelfCollectorAuth } from "@/lib/shelf/collectorAuth";

export const dynamic = "force-dynamic";

// Приём снимка «Смотрите также» от внешнего сборщика. Один запрос — один
// артикул (контракт scrape.js автора наработок). Артикул может отслеживаться
// в нескольких кабинетах — снимок пишется в каждый активный watch.
// Повторная отправка того же сбора (watch_id + collected_at) — идемпотентный no-op.
export async function POST(request: NextRequest) {
  const denied = checkShelfCollectorAuth(request);
  if (denied) return denied;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });

  const body = await request.json().catch(() => null);
  const parsed = parseShelfSnapshotPayload(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const { snapshot } = parsed;

  const watches = await db
    .from("wb_shelf_watch")
    .select("id, cabinet_id, nm_id, our_brand, our_link, our_img, active")
    .eq("nm_id", snapshot.nmId)
    .eq("active", true);
  if (watches.error) return NextResponse.json({ ok: false, error: watches.error.message }, { status: 502 });
  if (!watches.data?.length) {
    // Не ошибка: артикул могли выключить между выдачей списка и сбором.
    return NextResponse.json({ ok: true, written: 0, note: "артикул не отслеживается" });
  }

  let written = 0;
  let duplicates = 0;
  for (const watch of watches.data) {
    // Бренд/ссылка/фото — автозаполнение при первом снимке, без перезаписи.
    const meta: Record<string, string> = {};
    if (!watch.our_brand && snapshot.our.brand) meta.our_brand = snapshot.our.brand;
    if (!watch.our_link && snapshot.our.link) meta.our_link = snapshot.our.link;
    if (!watch.our_img && snapshot.our.img) meta.our_img = snapshot.our.img;
    if (Object.keys(meta).length) {
      const updated = await db.from("wb_shelf_watch").update(meta).eq("id", watch.id);
      if (updated.error) return NextResponse.json({ ok: false, error: updated.error.message }, { status: 502 });
    }

    // Дедуп с ремонтом сирот: если прошлая запись этого же сбора оборвалась
    // между шапкой и строками (таймаут), осталась шапка без конкурентов —
    // повторная отправка с конкурентами перезаписывает её, а не утыкается
    // в дедуп навсегда.
    const existing = await db
      .from("wb_shelf_snapshots")
      .select("id, wb_shelf_snapshot_rows(id)")
      .eq("watch_id", watch.id)
      .eq("collected_at", snapshot.collectedAt)
      .maybeSingle();
    if (existing.error) return NextResponse.json({ ok: false, error: existing.error.message }, { status: 502 });
    if (existing.data) {
      const orphan = (existing.data.wb_shelf_snapshot_rows ?? []).length === 0 && snapshot.competitors.length > 0;
      if (!orphan) {
        duplicates++;
        continue;
      }
      const removed = await db.from("wb_shelf_snapshots").delete().eq("id", existing.data.id);
      if (removed.error) return NextResponse.json({ ok: false, error: removed.error.message }, { status: 502 });
    }

    const inserted = await db
      .from("wb_shelf_snapshots")
      .insert({
        watch_id: watch.id,
        cabinet_id: watch.cabinet_id,
        nm_id: snapshot.nmId,
        collected_at: snapshot.collectedAt,
        our_price: snapshot.our.price,
        our_brand: snapshot.our.brand,
        our_img: snapshot.our.img,
        competitor_count: snapshot.competitors.length,
      })
      .select("id")
      .maybeSingle();
    if (inserted.error) {
      // 23505 — гонка двух одинаковых отправок: вторая честно считается дублем.
      if (inserted.error.code === "23505") {
        duplicates++;
        continue;
      }
      return NextResponse.json({ ok: false, error: inserted.error.message }, { status: 502 });
    }
    const snapshotId = inserted.data?.id;
    if (!snapshotId) return NextResponse.json({ ok: false, error: "Снимок не записался" }, { status: 502 });

    if (snapshot.competitors.length) {
      const rows = snapshot.competitors.map((row) => ({
        snapshot_id: snapshotId,
        position: row.position,
        nm_id: row.nmId,
        brand: row.brand,
        price: row.price,
        img: row.img,
      }));
      const insertedRows = await db.from("wb_shelf_snapshot_rows").insert(rows);
      if (insertedRows.error) {
        // Строки не легли — сносим шапку, чтобы не осталось снимка-пустышки,
        // который выглядел бы как «конкурентов не было».
        await db.from("wb_shelf_snapshots").delete().eq("id", snapshotId);
        return NextResponse.json({ ok: false, error: insertedRows.error.message }, { status: 502 });
      }
    }
    written++;
  }

  return NextResponse.json({ ok: true, written, duplicates });
}
