import { NextRequest, NextResponse } from "next/server";

import { auditAdvertOperation, resolveAdvertCabinetContext } from "@/lib/adverts/cabinetGuard";
import { renameAdvert } from "@/lib/wb/advertApi";

export const dynamic = "force-dynamic";

/**
 * Переименование кампании. Единственное действие модуля, которое не влияет
 * ни на показы, ни на деньги, — но в журнал попадает наравне с остальными:
 * «кампания называлась иначе» объясняет добрую половину недоразумений при
 * разборе истории.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const advertId = Number(body.advertId);
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!Number.isInteger(advertId) || advertId <= 0) return NextResponse.json({ error: "Нужен advertId" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Название не может быть пустым" }, { status: 400 });
  if (name.length > 128) return NextResponse.json({ error: "Название длиннее 128 символов" }, { status: 400 });

  const resolved = await resolveAdvertCabinetContext({ cabinetId: body.cabinetId, advertIds: [advertId] });
  if (resolved.response) return resolved.response;
  const context = resolved.context;

  const { data: before } = await context.db
    .from("wb_adverts")
    .select("name")
    .eq("advert_id", advertId)
    .eq("cabinet_id", context.cabinet.id)
    .maybeSingle();
  const oldName = before?.name ? String(before.name) : null;

  const result = await renameAdvert(context.token, advertId, name);

  await auditAdvertOperation({
    context,
    advertId,
    action: "rename",
    status: result.ok ? "ok" : "error",
    oldValue: oldName,
    newValue: name,
    wbResult: result.ok ? result.data : result.raw ?? result.message,
  });

  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status === 0 ? 500 : 502 });

  await context.db.from("wb_adverts").update({ name }).eq("advert_id", advertId).eq("cabinet_id", context.cabinet.id);
  return NextResponse.json({ ok: true, advertId, name, oldName });
}
