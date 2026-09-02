import { NextRequest, NextResponse } from "next/server";

import { auditAdvertOperation, resolveAdvertCabinetContext } from "@/lib/adverts/cabinetGuard";
import {
  deleteClusterBids,
  getClusterBids,
  getClusterList,
  setClusterBids,
  type ClusterBidInput,
} from "@/lib/wb/advertApi";

export const dynamic = "force-dynamic";

function parsePair(source: { get(key: string): string | null }) {
  const advertId = Number(source.get("advertId"));
  const nmId = Number(source.get("nmId"));
  if (!Number.isInteger(advertId) || advertId <= 0) return { error: "Нужен advertId" as const };
  if (!Number.isInteger(nmId) || nmId <= 0) return { error: "Нужен nmId" as const };
  return { advertId, nmId };
}

/**
 * Кластеры артикула в кампании: какие работают, какие исключены, какие в архиве,
 * и какие из них имеют собственную ставку.
 *
 * Два запроса в WB вместо одного, потому что это два разных факта. Список
 * кластеров показывает, что вообще происходит с запросами, а ставки — где
 * человек уже вмешался. Склеиваем здесь, чтобы интерфейс видел кластер сразу со
 * своей ставкой: «фраза без ставки» и «фраза со ставкой, равной ставке
 * кампании» выглядят одинаково, но означают разное.
 *
 * Порог WB важно назвать вслух: в списке только кластеры, набравшие не меньше
 * 100 показов. Пустой ответ у молодой кампании — это «ещё не набралось», а не
 * «запросов нет», и интерфейс обязан говорить именно так.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const pair = parsePair(params);
  if ("error" in pair) return NextResponse.json({ error: pair.error }, { status: 400 });

  const resolved = await resolveAdvertCabinetContext({ cabinetId: params.get("cabinet"), advertIds: [pair.advertId] });
  if (resolved.response) return resolved.response;
  const { token } = resolved.context;

  const [list, bids] = await Promise.all([
    getClusterList(token, [pair]),
    getClusterBids(token, [pair]),
  ]);

  if (!list.ok) {
    return NextResponse.json({ error: list.message }, { status: list.status === 0 ? 500 : 502 });
  }

  const item = (list.data.items ?? []).find((row) => row.advertId === pair.advertId) ?? null;
  const bidByQuery = new Map<string, number>();
  if (bids.ok) {
    for (const row of bids.data.bids ?? []) {
      if (row.advert_id === pair.advertId && row.nm_id === pair.nmId) bidByQuery.set(row.norm_query, row.bid);
    }
  }

  const shape = (queries: string[] | null | undefined) =>
    (queries ?? []).map((query) => ({ query, bid: bidByQuery.get(query) ?? null }));

  return NextResponse.json({
    advertId: pair.advertId,
    nmId: pair.nmId,
    active: shape(item?.normQueries?.active),
    excluded: shape(item?.normQueries?.excluded),
    archived: shape(item?.normQueries?.archived),
    // Ставки могли не прочитаться, хотя список пришёл. Молчать об этом нельзя:
    // иначе «ставок нет» и «ставки не удалось узнать» выглядят одинаково.
    bidsError: bids.ok ? null : bids.message,
    note: "WB показывает только кластеры, набравшие от 100 показов.",
  });
}

/**
 * Установка ставок на кластеры.
 *
 * WB принимает этот метод только у кампаний с ручной ставкой и оплатой за
 * показы. Проверку типа делаем до сети: отказ WB здесь приходит текстом
 * «invalid payment_type value», по которому человеку нечего понять.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const advertId = Number(body.advertId);
  const nmId = Number(body.nmId);
  const items: Array<{ query?: unknown; bid?: unknown }> = Array.isArray(body.bids) ? body.bids : [];

  if (!Number.isInteger(advertId) || advertId <= 0) return NextResponse.json({ error: "Нужен advertId" }, { status: 400 });
  if (!Number.isInteger(nmId) || nmId <= 0) return NextResponse.json({ error: "Нужен nmId" }, { status: 400 });
  if (!items.length) return NextResponse.json({ error: "Не переданы ставки по кластерам" }, { status: 400 });
  if (items.length > 100) return NextResponse.json({ error: "WB принимает не больше 100 кластеров за раз" }, { status: 400 });

  const resolved = await resolveAdvertCabinetContext({ cabinetId: body.cabinetId, advertIds: [advertId] });
  if (resolved.response) return resolved.response;
  const context = resolved.context;

  const { data: advertRow } = await context.db
    .from("wb_adverts")
    .select("bid_type, payment_type")
    .eq("advert_id", advertId)
    .eq("cabinet_id", context.cabinet.id)
    .maybeSingle();
  const bidType = String(advertRow?.bid_type ?? "").toLowerCase();
  const paymentType = String(advertRow?.payment_type ?? "").toLowerCase();
  if (bidType && bidType !== "manual" && bidType !== "cpm" && bidType !== "auction") {
    return NextResponse.json(
      { error: "Ставки по кластерам доступны только кампаниям с ручной ставкой. У этой ставка единая — местами и запросами распоряжается WB." },
      { status: 400 },
    );
  }
  if (paymentType === "cpc") {
    return NextResponse.json(
      { error: "Ставки по кластерам доступны только при оплате за показы. У этой кампании оплата за клики." },
      { status: 400 },
    );
  }

  const bids: ClusterBidInput[] = [];
  for (const item of items) {
    const query = typeof item.query === "string" ? item.query.trim() : "";
    const bid = Number(item.bid);
    if (!query) return NextResponse.json({ error: "У ставки не указан кластер" }, { status: 400 });
    if (!Number.isFinite(bid) || bid <= 0 || !Number.isInteger(bid)) {
      return NextResponse.json({ error: `Ставка по кластеру «${query}» должна быть целым числом больше нуля` }, { status: 400 });
    }
    bids.push({ advertId, nmId, normQuery: query, bid });
  }

  const result = await setClusterBids(context.token, bids);
  const summary = bids.map((bid) => ({ query: bid.normQuery, bid: bid.bid }));

  await auditAdvertOperation({
    context,
    advertId,
    action: "cluster_bid",
    status: result.ok ? "ok" : "error",
    oldValue: { nmId },
    newValue: summary,
    wbResult: result.ok ? result.data : result.raw ?? result.message,
  });

  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status === 0 ? 500 : 502 });
  return NextResponse.json({ ok: true, advertId, nmId, bids: summary });
}

/** Снятие собственных ставок с кластеров — они возвращаются к ставке кампании. */
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const advertId = Number(body.advertId);
  const nmId = Number(body.nmId);
  const queries: string[] = Array.isArray(body.queries)
    ? body.queries.filter((query: unknown): query is string => typeof query === "string" && query.trim().length > 0)
    : [];

  if (!Number.isInteger(advertId) || advertId <= 0) return NextResponse.json({ error: "Нужен advertId" }, { status: 400 });
  if (!Number.isInteger(nmId) || nmId <= 0) return NextResponse.json({ error: "Нужен nmId" }, { status: 400 });
  if (!queries.length) return NextResponse.json({ error: "Не указаны кластеры" }, { status: 400 });

  const resolved = await resolveAdvertCabinetContext({ cabinetId: body.cabinetId, advertIds: [advertId] });
  if (resolved.response) return resolved.response;
  const context = resolved.context;

  const result = await deleteClusterBids(
    context.token,
    queries.map((query) => ({ advertId, nmId, normQuery: query.trim() })),
  );

  await auditAdvertOperation({
    context,
    advertId,
    action: "cluster_bid_delete",
    status: result.ok ? "ok" : "error",
    oldValue: { nmId, queries },
    newValue: null,
    wbResult: result.ok ? result.data : result.raw ?? result.message,
  });

  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status === 0 ? 500 : 502 });
  return NextResponse.json({ ok: true, advertId, nmId, removed: queries.length });
}
