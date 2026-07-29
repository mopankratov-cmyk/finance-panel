import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { generateUgcScript } from "@/lib/ugc/script";
import { loadUgcProduct, UgcProductError } from "@/lib/ugc/product";
import { normalizeUgcCreativeInput } from "@/lib/ugc/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const cabinetId = cabinetIdFromParam(typeof body.cabinetId === "string" ? body.cabinetId : null);
  const nmId = Number(body.nmId);
  if (!cabinetId || !Number.isSafeInteger(nmId) || nmId <= 0) return NextResponse.json({ ok: false, error: "Выберите кабинет и SKU" }, { status: 400 });
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ ok: false, error: "Нет доступа к кабинету" }, { status: 403 });
  const normalized = normalizeUgcCreativeInput(body);
  if (!normalized.ok) return NextResponse.json({ ok: false, error: normalized.error }, { status: 422 });
  try {
    const product = await loadUgcProduct(cabinetId, nmId);
    const script = await generateUgcScript(product, normalized.value.avatarId, normalized.value.brief);
    return NextResponse.json({ ok: true, script });
  } catch (error) {
    const status = error instanceof UgcProductError ? error.status : 502;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не удалось подготовить сценарий" }, { status });
  }
}
