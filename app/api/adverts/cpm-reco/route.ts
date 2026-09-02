import { NextRequest, NextResponse } from "next/server";

import { resolveAdvertCabinetContext } from "@/lib/adverts/cabinetGuard";
import { getBidRecommendations } from "@/lib/wb/advertApi";

export const dynamic = "force-dynamic";

interface Bid {
  bidKopecks?: number;
}

interface CpmResponse {
  paymentType?: "cpm";
  base?: { competitiveBid?: Bid; leadersBid?: Bid; top2?: Bid };
}

interface CpcResponse {
  paymentType?: "cpc";
  levels?: Array<{ range1To2?: Bid; range3To10?: Bid; range11To34?: Bid }>;
}

export interface BidRecommendation {
  label: string;
  hint: string;
  bidRub: number;
}

const rub = (bid: Bid | undefined): number | null => {
  const kopecks = bid?.bidKopecks;
  return typeof kopecks === "number" && kopecks > 0 ? Math.round(kopecks) / 100 : null;
};

/**
 * Рекомендованные ставки самого WB — и подписи к ним.
 *
 * Роут существовал с первого дня модуля и не вызывался ни одним экраном: он
 * отдавал сырой ответ WB, а разобрать его на месте было некому. Между тем это
 * единственный в панели ответ на вопрос, с которого начинается работа со
 * ставкой: «а сколько ставить-то».
 *
 * Подписи здесь не украшение. «Конкурентная 210 ₽» ничего не значит, пока не
 * сказано, что это средняя ставка продавцов похожего товара по похожей цене и
 * что у половины из них ставка выше. Число без этого объяснения читается как
 * рекомендация панели, хотя это наблюдение WB за рынком.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const advertId = Number(params.get("advertId"));
  const nmId = Number(params.get("nmId"));
  if (!Number.isInteger(advertId) || advertId <= 0) return NextResponse.json({ error: "Нужен advertId" }, { status: 400 });
  if (!Number.isInteger(nmId) || nmId <= 0) return NextResponse.json({ error: "Нужен nmId" }, { status: 400 });

  const resolved = await resolveAdvertCabinetContext({ cabinetId: params.get("cabinet"), advertIds: [advertId] });
  if (resolved.response) return resolved.response;

  const result = await getBidRecommendations(resolved.context.token, advertId, nmId);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status === 0 ? 500 : 502 });
  }

  const data = result.data as CpmResponse & CpcResponse;
  const recommendations: BidRecommendation[] = [];

  if (data?.paymentType === "cpc") {
    // У оплаты за клик WB рассуждает позициями, а не «конкурентами»: сколько
    // стоит попасть в первую пару, в первую десятку и так далее.
    const level = data.levels?.[0];
    const rows: Array<[string, Bid | undefined, string]> = [
      ["Позиции 1–2", level?.range1To2, "Верх выдачи. Самый дорогой клик."],
      ["Позиции 3–10", level?.range3To10, "Первая страница без борьбы за первое место."],
      ["Позиции 11–34", level?.range11To34, "Дешёвый охват ниже первой страницы."],
    ];
    for (const [label, bid, hint] of rows) {
      const value = rub(bid);
      if (value != null) recommendations.push({ label, hint, bidRub: value });
    }
  } else {
    const rows: Array<[string, Bid | undefined, string]> = [
      ["Конкурентная", data?.base?.competitiveBid, "Средняя ставка продавцов похожего товара по похожей цене: у половины из них выше, у половины ниже."],
      ["Лидерская", data?.base?.leadersBid, "Средняя ставка тех, кто занимает лидирующие позиции в вашей категории."],
      ["Топовая", data?.base?.top2, "Ставка верхних мест. У части предметов WB её не считает."],
    ];
    for (const [label, bid, hint] of rows) {
      const value = rub(bid);
      if (value != null) recommendations.push({ label, hint, bidRub: value });
    }
  }

  return NextResponse.json({
    advertId,
    nmId,
    paymentType: data?.paymentType ?? "cpm",
    recommendations,
    // Пустой список — не ошибка: WB не считает рекомендации для части предметов
    // и для кампаний без истории. Сказать это словами дешевле, чем оставить
    // человека гадать, сломалось ли что-то.
    note: recommendations.length ? null : "WB не отдал рекомендаций по этой кампании — так бывает у новых кампаний и у части предметов.",
  });
}
