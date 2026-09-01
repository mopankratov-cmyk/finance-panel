import { NextRequest, NextResponse } from "next/server";

import { resolveAdvertCabinetAccess } from "@/lib/adverts/cabinetGuard";
import { depositAllowance } from "@/lib/adverts/depositLimits";
import { advertHost, getAdvertBalance, getAdvertConfig } from "@/lib/wb/advertApi";
import { decodeWbToken } from "@/lib/wb/token";

export const dynamic = "force-dynamic";

/**
 * Состояние кабинета перед тем, как в нём что-то менять: деньги, валюта, шаг
 * ставки, срок жизни ключа и остаток суточного лимита пополнений.
 *
 * Собрано в один роут намеренно. Эти величины бессмысленны поодиночке: сумма на
 * счету без валюты ничего не значит, минимальное пополнение без остатка лимита
 * не отвечает на вопрос «сколько я могу положить прямо сейчас». Интерфейс,
 * которому пришлось бы склеивать их из трёх запросов, показывал бы
 * промежуточные полукартинки — а это ровно тот экран, где нажимают кнопку с
 * деньгами.
 *
 * Проверка «можно ли писать» здесь честно неполная, и это осознанно. WB не
 * раскрывает в токене признак «только на чтение», поэтому роут отвечает лишь на
 * то, что действительно знает: категория «Продвижение» доступна и ключ не
 * протух. Право записи выясняется на первой же попытке записи, и текст отказа
 * WB на этот случай уже переведён в advertApi. Обещать проверку, которой нет,
 * хуже, чем её отсутствие: человек поверит зелёной галочке и узнает правду в
 * тот момент, когда будет менять ставку.
 */
export async function GET(request: NextRequest) {
  const cabinetId = new URL(request.url).searchParams.get("cabinet");
  const gate = await resolveAdvertCabinetAccess(cabinetId);
  if (gate.response) return gate.response;
  const { db, cabinet, token } = gate.access;

  const info = decodeWbToken(token);
  const [config, balance, allowance] = await Promise.all([
    getAdvertConfig(token),
    getAdvertBalance(token),
    depositAllowance(db, cabinet.id),
  ]);

  return NextResponse.json({
    cabinet: { id: cabinet.id, name: cabinet.name },
    token: {
      // Песочница — не мелочь: в ней действия ничего не стоят, и человек должен
      // видеть, что нажимает не по боевому кабинету.
      sandbox: info.isTest,
      host: advertHost(token),
      expiresAt: info.expiresAt,
      daysLeft: info.daysLeft,
      isExpired: info.isExpired,
      promotionAvailable: config.ok,
      promotionError: config.ok ? null : config.message,
    },
    config: config.ok
      ? {
          currency: config.data.currency,
          cpmStepRub: config.data.cpmStep / 100,
          cpcStepRub: config.data.cpcStep / 100,
          minTopUpRub: config.data.minTopUp / 100,
        }
      : null,
    money: balance.ok
      ? { account: balance.data.balance, net: balance.data.net, bonus: balance.data.bonus, currency: balance.data.currency }
      : null,
    moneyError: balance.ok ? null : balance.message,
    depositAllowance: allowance,
  });
}
