import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { sessionRoles } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import { BrightDataError, datasetMetadata, datasetSnapshotRecords, filterDataset, hasBrightData, listDatasets, snapshotProgress, snapshotRecords, triggerCollection } from "@/lib/assortment/brightdata";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Пилот Bright Data для модуля «Разработка ассортимента»: какие сборщики есть
 * (бесплатно) и проба на 10–20 записях (тратит кредиты). Только директор:
 * проба стоит денег. Ответы — без цен (вырезаются в lib/assortment/brightdata).
 *
 * GET ?action=catalog | ?action=status&snapshot=s_… | ?action=records&snapshot=s_…
 *     ?action=dataset_meta&dataset=gd_… | ?action=dataset_records&snapshot=s_…
 * POST { datasetId, inputs: [{url|keyword…}], discoverBy?, limitPerInput }
 *      { action: "filter", datasetId, filter, recordsLimit } — выборка готового набора
 */
async function directorOnly() {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return { error: gate, session: null };
  const session = await getServerSession();
  if (!sessionRoles(session).includes("director")) {
    return { error: NextResponse.json({ error: "Пилот Bright Data запускает только руководитель: он тратит кредиты" }, { status: 403 }), session: null };
  }
  if (!hasBrightData()) return { error: NextResponse.json({ error: "Ключ Bright Data не задан в окружении панели" }, { status: 503 }), session: null };
  return { error: null, session };
}

const failure = (error: unknown) => NextResponse.json(
  { error: error instanceof Error ? error.message : "Bright Data не ответил" },
  { status: error instanceof BrightDataError && error.status && error.status < 500 ? 400 : 502 },
);

export async function GET(request: NextRequest) {
  const { error } = await directorOnly();
  if (error) return error;
  const action = request.nextUrl.searchParams.get("action") ?? "catalog";
  const snapshot = request.nextUrl.searchParams.get("snapshot") ?? "";
  try {
    if (action === "status") return NextResponse.json(await snapshotProgress(snapshot));
    if (action === "records") return NextResponse.json(await snapshotRecords(snapshot, 20));
    if (action === "dataset_meta") return NextResponse.json(await datasetMetadata(request.nextUrl.searchParams.get("dataset") ?? ""));
    if (action === "dataset_records") return NextResponse.json((await datasetSnapshotRecords(snapshot, 20)) ?? { pending: true });
    return NextResponse.json({ datasets: await listDatasets() });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  const { error, session } = await directorOnly();
  if (error) return error;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.action === "filter") {
    try {
      const snapshotId = await filterDataset(String(body.datasetId ?? ""), body.filter, Number(body.recordsLimit) || 10);
      await audit(request, session, { action: "assortment.update", subject: "brightdata:dataset-filter", after: { datasetId: body.datasetId, recordsLimit: body.recordsLimit, snapshotId } });
      return NextResponse.json({ snapshotId });
    } catch (e) {
      return failure(e);
    }
  }
  const inputs = Array.isArray(body?.inputs) ? (body.inputs as unknown[]).filter((i): i is Record<string, string> => Boolean(i) && typeof i === "object") : [];
  if (inputs.length === 0) return NextResponse.json({ error: "Нужен хотя бы один вход (url или ключевое слово)" }, { status: 400 });
  try {
    const snapshotId = await triggerCollection({
      datasetId: String(body?.datasetId ?? ""),
      inputs,
      discoverBy: typeof body?.discoverBy === "string" ? body.discoverBy : null,
      limitPerInput: Number(body?.limitPerInput) || 10,
    });
    await audit(request, session, { action: "assortment.update", subject: "brightdata:pilot", after: { datasetId: body?.datasetId, inputs: inputs.length, snapshotId } });
    return NextResponse.json({ snapshotId });
  } catch (e) {
    return failure(e);
  }
}
