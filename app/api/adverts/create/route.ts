import { NextRequest, NextResponse } from "next/server";

import { auditAdvertOperation, resolveAdvertCabinetAccess, type AdvertCabinetContext } from "@/lib/adverts/cabinetGuard";
import { createAdvert } from "@/lib/wb/advertApi";
import { cabinetProductScope } from "@/lib/wb/cabinetTokens";
import { allowsNm, isScoped } from "@/lib/wb/productScope";

export const dynamic = "force-dynamic";

const BID_TYPES = ["manual", "unified"] as const;
const PAYMENT_TYPES = ["cpm", "cpc"] as const;
const PLACEMENTS = ["search", "recommendations"] as const;

type BidType = (typeof BID_TYPES)[number];
type PaymentType = (typeof PAYMENT_TYPES)[number];
type Placement = (typeof PLACEMENTS)[number];

/**
 * Создание рекламной кампании.
 *
 * Единственное действие модуля, которое нельзя отменить вообще ничем: у WB нет
 * метода «удалить только что созданную кампанию» — есть только «завершить», и
 * завершённая кампания остаётся в кабинете навсегда. Поэтому здесь нет и не
 * будет массового режима, а лимит WB на метод самый жёсткий из всех: пять
 * запросов в минуту на аккаунт продавца.
 *
 * Отдельно проверяется товарный контур кабинета. В агентских кабинетах живут
 * чужие артикулы, и панель уже умеет отделять свои — было бы странно закрывать
 * чужие данные на чтение, но позволять завести на них кампанию за свой счёт.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const bidType = body.bidType as BidType;
  const paymentType = (typeof body.paymentType === "string" ? body.paymentType : "cpm") as PaymentType;
  const rawNms: unknown[] = Array.isArray(body.nms) ? body.nms : [];
  const rawPlacements: unknown[] = Array.isArray(body.placementTypes) ? body.placementTypes : [];

  if (!name) return NextResponse.json({ error: "Нужно название кампании" }, { status: 400 });
  if (name.length > 128) return NextResponse.json({ error: "Название длиннее 128 символов" }, { status: 400 });
  if (!BID_TYPES.includes(bidType)) return NextResponse.json({ error: "Выберите тип ставки: ручная или единая" }, { status: 400 });
  if (!PAYMENT_TYPES.includes(paymentType)) return NextResponse.json({ error: "Выберите оплату: за показы или за клики" }, { status: 400 });

  const nms = [...new Set(rawNms.map(Number).filter((nm) => Number.isInteger(nm) && nm > 0))];
  if (!nms.length) return NextResponse.json({ error: "Не выбран ни один артикул" }, { status: 400 });
  if (nms.length > 50) return NextResponse.json({ error: "WB берёт в кампанию не больше 50 артикулов" }, { status: 400 });

  const placementTypes = rawPlacements.filter((item): item is Placement => PLACEMENTS.includes(item as Placement));
  if (bidType === "manual" && !placementTypes.length) {
    return NextResponse.json({ error: "У кампании с ручной ставкой нужно выбрать место показа" }, { status: 400 });
  }

  const gate = await resolveAdvertCabinetAccess(body.cabinetId);
  if (gate.response) return gate.response;
  const { session, db, cabinet, token } = gate.access;

  const scope = cabinetProductScope(cabinet);
  if (isScoped(scope)) {
    const foreign = nms.filter((nm) => !allowsNm(scope, nm));
    if (foreign.length) {
      return NextResponse.json(
        { error: `Эти артикулы не относятся к кабинету «${cabinet.name}»: ${foreign.slice(0, 5).join(", ")}${foreign.length > 5 ? "…" : ""}` },
        { status: 403 },
      );
    }
  }

  // Журнал ждёт контекст с картой кампаний; у создания кампании ещё нет, и
  // подделывать её нечем. Отдаём пустую карту — запись в журнал ей не пользуется.
  const context: AdvertCabinetContext = { session, db, cabinet, token, adverts: new Map() };
  const settings = { name, bidType, paymentType, nms, placementTypes: bidType === "manual" ? placementTypes : [] };

  const result = await createAdvert(token, { name, nms, bidType, paymentType, placementTypes });
  if (!result.ok) {
    await auditAdvertOperation({
      context,
      // Кампании ещё не существует, а advert_id в журнале обязателен. Ноль —
      // явная метка «создание, которое не состоялось»: он не может совпасть ни
      // с одной настоящей кампанией.
      advertId: 0,
      action: "create",
      status: "error",
      oldValue: null,
      newValue: settings,
      wbResult: result.raw ?? result.message,
    });
    return NextResponse.json({ error: result.message }, { status: result.status === 0 ? 500 : 502 });
  }

  const advertId = Number(result.data);
  await auditAdvertOperation({
    context,
    advertId: Number.isInteger(advertId) && advertId > 0 ? advertId : 0,
    action: "create",
    status: "ok",
    oldValue: null,
    newValue: settings,
    wbResult: result.data,
  });

  return NextResponse.json({
    ok: true,
    advertId,
    name,
    // Кампания создаётся остановленной и без денег. Сказать об этом сразу
    // дешевле, чем ждать вопроса «создал, а показов нет».
    next: "Кампания создана и стоит. Пополните бюджет и запустите её.",
  });
}
