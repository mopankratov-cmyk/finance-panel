import { NextRequest, NextResponse } from "next/server";

import { auditAdvertOperation, resolveAdvertCabinetContext } from "@/lib/adverts/cabinetGuard";
import { getAdvertConfig, setAdvertBids, type AdvertPlacement, type NmBidInput } from "@/lib/wb/advertApi";

export const dynamic = "force-dynamic";

// Предохранитель от опечатки: разовый рост ставки больше чем в два раза почти
// всегда лишний ноль, а не намерение. Снижения не ограничены — уменьшить расход
// человеку никто мешать не должен.
const MAX_GROWTH_FACTOR = 2;

const PLACEMENTS: AdvertPlacement[] = ["search", "recommendations", "combined"];

interface IncomingBid {
  nmId: unknown;
  bidRub: unknown;
  placement: unknown;
}

/**
 * Изменение ставок кампании.
 *
 * Переписано под действующую схему WB. Прежняя версия слала
 * `{advertId, cpm, instrument}` — форму, которой в текущей спеке Продвижения нет
 * вовсе, так что метод отвечал на неё четырёхсотой. Сегодня ставка задаётся
 * потоварно и поместно: bids[] → nm_bids[] → {nm_id, bid_kopecks, placement}.
 *
 * Из этого следует и требование к вызывающему: артикул и место обязательны.
 * Подставлять их за пользователя нельзя — «первый артикул кампании» и «поиск по
 * умолчанию» это молчаливое изменение ставки не там, куда он смотрел.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const advertId: number | null = typeof body.advertId === "number" ? body.advertId : null;
  const rawBids: IncomingBid[] = Array.isArray(body.bids) ? body.bids : [];

  if (!advertId) return NextResponse.json({ error: "Нужен advertId" }, { status: 400 });
  if (!rawBids.length) return NextResponse.json({ error: "Не переданы ставки" }, { status: 400 });
  if (rawBids.length > 50) return NextResponse.json({ error: "WB принимает не больше 50 артикулов за раз" }, { status: 400 });

  // Причина словами человека — необязательна, пишется в журнал как есть.
  const reason = typeof body.reason === "string" ? body.reason : null;
  const resolved = await resolveAdvertCabinetContext({ cabinetId: body.cabinetId, advertIds: [advertId] });
  if (resolved.response) return resolved.response;
  const context = resolved.context;

  // Тип ставки решает, какие места допустимы. У единой ставки WB принимает
  // только `combined`, у ручной — только search/recommendations. Отправить не ту
  // пару значит получить отказ, объяснить который пользователю будет нечем.
  const { data: advertRow } = await context.db
    .from("wb_adverts")
    .select("bid_type")
    .eq("advert_id", advertId)
    .eq("cabinet_id", context.cabinet.id)
    .maybeSingle();
  const bidType = String(advertRow?.bid_type ?? "").toLowerCase();
  const isUnified = bidType === "unified" || bidType === "auto" || bidType === "automatic";

  const parsed: Array<{ nmId: number; bidRub: number; placement: AdvertPlacement }> = [];
  for (const item of rawBids) {
    const nmId = Number(item.nmId);
    const bidRub = Number(item.bidRub);
    const placement = String(item.placement) as AdvertPlacement;

    if (!Number.isInteger(nmId) || nmId <= 0) {
      return NextResponse.json({ error: "В ставке нет корректного артикула" }, { status: 400 });
    }
    if (!Number.isFinite(bidRub) || bidRub <= 0) {
      return NextResponse.json({ error: `Ставка по артикулу ${nmId} должна быть больше нуля` }, { status: 400 });
    }
    if (!PLACEMENTS.includes(placement)) {
      return NextResponse.json({ error: `Неизвестное место показа у артикула ${nmId}` }, { status: 400 });
    }
    if (isUnified && placement !== "combined") {
      return NextResponse.json(
        { error: "У кампании с единой ставкой место показа выбирает WB — доступно только «поиск и рекомендации»" },
        { status: 400 },
      );
    }
    if (!isUnified && placement === "combined") {
      return NextResponse.json(
        { error: "У кампании с ручной ставкой нужно указать поиск или рекомендации отдельно" },
        { status: 400 },
      );
    }
    parsed.push({ nmId, bidRub, placement });
  }

  // Шаг ставки и валюту диктует WB: у кабинета не обязательно рубль, и
  // допустимый шаг тоже его. Не сошлись — WB откажет, поэтому проверяем заранее
  // и объясняем человеческим языком.
  const config = await getAdvertConfig(context.token);
  const stepKopecks = config.ok && config.data.cpmStep > 0 ? config.data.cpmStep : 100;

  const oldBid = context.adverts.get(advertId)?.bid_cpm_rub ?? null;
  const bids: NmBidInput[] = [];
  // Сработала ли защита от роста ×2. Если прежняя ставка неизвестна, она не
  // сработает — и об этом надо сказать вслух в ответе, а не промолчать.
  let unguarded = false;
  for (const raw of parsed) {
    const kopecks = Math.round(raw.bidRub * 100);
    if (kopecks % stepKopecks !== 0) {
      const stepRub = stepKopecks / 100;
      return NextResponse.json(
        { error: `Ставка по артикулу ${raw.nmId} должна быть кратна шагу ${stepRub} ${config.ok ? config.data.currency : ""}`.trim() },
        { status: 400 },
      );
    }
    // Защита работает только когда есть от чего считать. Раньше при пустой
    // прежней ставке условие было ложным и проверка пропускалась целиком —
    // молча, ровно в том случае, где ошибиться проще всего.
    if (oldBid == null || !(oldBid > 0)) {
      unguarded = true;
    } else if (raw.bidRub > oldBid * MAX_GROWTH_FACTOR) {
      await auditAdvertOperation({
        context,
        reason,
        advertId,
        action: "bid",
        status: "rejected",
        oldValue: oldBid,
        newValue: raw.bidRub,
        wbResult: `рост >×${MAX_GROWTH_FACTOR} (было ${oldBid})`,
      });
      return NextResponse.json(
        { error: `Защита: нельзя поднять больше чем в ${MAX_GROWTH_FACTOR}× за раз (было ${oldBid}, лимит ${oldBid * MAX_GROWTH_FACTOR})` },
        { status: 400 },
      );
    }
    bids.push({ nmId: raw.nmId, bidKopecks: kopecks, placement: raw.placement });
  }

  const result = await setAdvertBids(context.token, [{ advertId, nmBids: bids }]);
  const newBidRub = bids[0].bidKopecks / 100;

  if (!result.ok) {
    await auditAdvertOperation({
      context,
      reason,
      advertId,
      action: "bid",
      status: "error",
      oldValue: oldBid,
      newValue: newBidRub,
      wbResult: result.raw ?? result.message,
    });
    return NextResponse.json({ error: result.message }, { status: result.status === 0 ? 500 : 502 });
  }

  // Локальная ставка кампании — справочная величина для списка. Пишем первую из
  // отправленных: у кампании с разными ставками по артикулам одного «правильного»
  // числа не существует, и следующий синк всё равно принесёт версию WB.
  await context.db
    .from("wb_adverts")
    .update({ bid_cpm_rub: newBidRub })
    .eq("advert_id", advertId)
    .eq("cabinet_id", context.cabinet.id);

  await auditAdvertOperation({
    context,
    reason,
    advertId,
    action: "bid",
    status: "ok",
    oldValue: oldBid,
    newValue: newBidRub,
    wbResult: result.data,
  });

  return NextResponse.json({
    ok: true,
    advertId,
    oldBid,
    unguarded,
    note: unguarded ? "Прежняя ставка кампании панели неизвестна — защита от роста ×2 не применялась." : null,
    bids: bids.map((b) => ({ nmId: b.nmId, bidRub: b.bidKopecks / 100, placement: b.placement })),
  });
}
