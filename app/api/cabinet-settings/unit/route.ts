import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  isRejectedCabinetPct,
  loadCabinetUnitSettings,
  normalizeCabinetPct,
  saveCabinetUnitSettings,
} from "@/lib/unit/cabinetSettings";

export const dynamic = "force-dynamic";

// Ручные настройки юнит-экономики кабинета: ставка налога и дополнительная
// комиссия. Читать может любой, кто видит финансовые экраны; менять — только те,
// кто отвечает за деньги: цифра отсюда меняет маржу во всех расчётах.
const READ_ROLES = ["director", "finance", "manager", "seller"] as const;
const WRITE_ROLES = ["director", "finance"] as const;

export async function GET(request: NextRequest) {
  const gate = await requireApiSession([...READ_ROLES]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });

  const cabinet = new URL(request.url).searchParams.get("cabinet");
  const ids = cabinet && cabinet !== "all" ? [cabinet] : null;
  try {
    const settings = await loadCabinetUnitSettings(db, ids);
    return NextResponse.json({ settings: [...settings.values()] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось прочитать настройки кабинета" },
      { status: 502 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireApiSession([...WRITE_ROLES]);
  if (gate) return gate;
  const session = await getServerSession();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    cabinetId?: string;
    taxPct?: unknown;
    extraCommissionPct?: unknown;
  };
  const cabinetId = String(body.cabinetId ?? "").trim();
  if (!cabinetId) return NextResponse.json({ error: "Укажите кабинет" }, { status: 400 });

  // Значение вне 0–100 не превращаем в «не задано»: молчаливое обнуление ставки
  // налога уехало бы в маржу по всем SKU и никто бы этого не заметил.
  for (const [field, value] of [["налога", body.taxPct], ["дополнительной комиссии", body.extraCommissionPct]] as const) {
    if (isRejectedCabinetPct(value)) {
      return NextResponse.json({ error: `Ставка ${field} должна быть числом от 0 до 100` }, { status: 400 });
    }
  }

  const cabinet = await db.from("wb_cabinets").select("id, name, marketplace").eq("id", cabinetId).maybeSingle();
  if (cabinet.error) return NextResponse.json({ error: cabinet.error.message }, { status: 502 });
  if (!cabinet.data) return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 });

  try {
    const saved = await saveCabinetUnitSettings(db, {
      cabinetId,
      taxPct: normalizeCabinetPct(body.taxPct),
      extraCommissionPct: normalizeCabinetPct(body.extraCommissionPct),
      updatedBy: session?.email ?? session?.role ?? null,
    });
    return NextResponse.json({ settings: saved, cabinet: { id: cabinet.data.id, name: cabinet.data.name } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось сохранить настройки кабинета" },
      { status: 502 },
    );
  }
}
