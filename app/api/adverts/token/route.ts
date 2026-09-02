import { NextRequest, NextResponse } from "next/server";

import { resolveAdvertCabinetAccess } from "@/lib/adverts/cabinetGuard";
import { getAdvertConfig, probeWriteAbility } from "@/lib/wb/advertApi";
import { decodeWbToken } from "@/lib/wb/token";

export const dynamic = "force-dynamic";

/** Последние символы ключа — чтобы человек узнал свой, не показывая его целиком. */
function mask(token: string): string {
  return `••••${token.trim().slice(-4)}`;
}

interface Verdict {
  ok: boolean;
  mask: string;
  sandbox: boolean;
  expiresAt: string | null;
  daysLeft: number | null;
  promotionAvailable: boolean;
  canWrite: boolean;
  message: string;
}

/**
 * Проверка ключа Продвижения по трём вопросам подряд, от дешёвого к дорогому:
 * читается ли он вообще, есть ли категория «Продвижение», умеет ли писать.
 *
 * Порядок не косметический. Истёкший ключ незачем гонять в WB, а ключ без
 * категории незачем проверять на запись: каждый следующий вопрос имеет смысл
 * только если предыдущий ответил «да», и человеку нужно видеть первую
 * несостыковку, а не последнюю.
 */
async function verify(token: string): Promise<Verdict> {
  const info = decodeWbToken(token);
  const base = {
    mask: mask(token),
    sandbox: info.isTest,
    expiresAt: info.expiresAt,
    daysLeft: info.daysLeft,
  };

  if (info.isExpired) {
    return { ...base, ok: false, promotionAvailable: false, canWrite: false, message: "Ключ истёк. Выпустите новый." };
  }

  const config = await getAdvertConfig(token);
  if (!config.ok) {
    return {
      ...base,
      ok: false,
      promotionAvailable: false,
      canWrite: false,
      message: `WB не принял ключ для Продвижения: ${config.message}`,
    };
  }

  const write = await probeWriteAbility(token);
  if (!write.can) {
    return {
      ...base,
      // «Не смогли спросить» — это не «нельзя». Ключ на чтение рабочий, и
      // отказывать в сохранении из-за сетевой заминки было бы неправильно:
      // право записи всё равно перепроверяется на первом же действии.
      ok: write.reason === "unknown",
      promotionAvailable: true,
      canWrite: false,
      message:
        write.reason === "unknown"
          ? `Ключ читает кабинет. Право записи проверить не удалось: ${write.message}`
          : write.message,
    };
  }

  return {
    ...base,
    ok: true,
    promotionAvailable: true,
    canWrite: true,
    message: info.isTest
      ? "Ключ песочницы: читает и пишет, но действия не касаются боевого кабинета."
      : "Ключ читает кабинет и может менять кампании.",
  };
}

/**
 * Проверить ключ и, если прислали новый, сохранить его как токен Продвижения
 * кабинета.
 *
 * Без `token` в теле — проверка текущего ключа. Это отдельный сценарий, а не
 * побочный: чаще всего человек приходит сюда не менять ключ, а понять, почему
 * кнопка не сработала.
 *
 * Ключ не возвращается наружу ни в каком виде, только маска. И не пишется в
 * журнал операций: журнал читают люди, а секрет, попавший в читаемую строку,
 * перестаёт быть секретом.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const gate = await resolveAdvertCabinetAccess(body.cabinetId);
  if (gate.response) return gate.response;
  const { db, cabinet, token: currentToken } = gate.access;

  const incoming = typeof body.token === "string" ? body.token.trim() : "";

  if (!incoming) {
    const verdict = await verify(currentToken);
    return NextResponse.json({ ...verdict, saved: false, cabinet: { id: cabinet.id, name: cabinet.name } });
  }

  // Форма присланного ключа. WB-токен — это JWT из трёх частей; проверить это
  // локально дешевле, чем узнавать от WB, и понятнее для человека, который
  // вставил не то из буфера.
  if (incoming.split(".").length !== 3) {
    return NextResponse.json({ error: "Это не похоже на токен WB. Ожидается ключ из трёх частей через точку." }, { status: 400 });
  }

  const verdict = await verify(incoming);
  // Ключ, который не читает кабинет, не сохраняем вовсе: подменить рабочий
  // ключ нерабочим значит сломать и то, что работало до сих пор.
  if (!verdict.promotionAvailable) {
    return NextResponse.json({ ...verdict, saved: false }, { status: 400 });
  }

  const { error } = await db.from("wb_cabinets").update({ token_advert: incoming }).eq("id", cabinet.id).eq("marketplace", "wb");
  if (error) return NextResponse.json({ error: `Не удалось сохранить ключ: ${error.message}` }, { status: 500 });

  return NextResponse.json({
    ...verdict,
    saved: true,
    cabinet: { id: cabinet.id, name: cabinet.name },
    // Ключ сохранён даже без права записи — но человек должен уйти со страницы,
    // зная, что кнопки останутся серыми, а не обнаружить это следующим кликом.
    message: verdict.canWrite
      ? `${verdict.message} Ключ сохранён для кабинета «${cabinet.name}».`
      : `${verdict.message} Ключ сохранён, но действия им выполнять нельзя.`,
  });
}
