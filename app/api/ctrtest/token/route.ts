import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { probeContentWriteAbility } from "@/lib/wb/media";
import { decodeWbToken } from "@/lib/wb/token";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ключ «Контент» прямо в модуле тестов.
 *
 * Автоматическая смена фото пишет в карточку на витрине, а ключи кабинетов
 * оказались выпущены «только на чтение»: WB отвечает 403 и прямым текстом
 * `read-only token cannot perform non-readonly requests`. Узнать об этом
 * человек должен ЗДЕСЬ, до запуска теста, а не из ошибки ночного крона.
 *
 * Место хранения не меняется — тот же `wb_cabinets.token_content`. Меняется
 * только место ввода: упираешься в ключ здесь, и уход на экран кабинетов
 * разрывает то самое действие, ради которого пришёл. Приём и формулировки
 * повторяют ключ Продвижения (components/wb/ads/AdTokenPanel).
 *
 * Поле ввода — password, и обратно ключ НИКОГДА не отдаётся: только маска из
 * четырёх последних символов, чтобы человек узнал свой.
 */

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

const mask = (token: string) => `••••${token.trim().slice(-4)}`;

interface Verdict {
  ok: boolean;
  mask: string | null;
  hasOwnKey: boolean;
  expiresAt: string | null;
  daysLeft: number | null;
  canWrite: boolean;
  reason: "read-only" | "no-scope" | "unknown" | null;
  message: string;
  saved?: boolean;
}

async function verify(token: string, hasOwnKey: boolean): Promise<Verdict> {
  const info = decodeWbToken(token);
  const base = { mask: mask(token), hasOwnKey, expiresAt: info.expiresAt, daysLeft: info.daysLeft };
  if (info.isExpired) {
    return { ...base, ok: false, canWrite: false, reason: "no-scope", message: "Ключ истёк. Выпустите новый." };
  }
  const write = await probeContentWriteAbility(token);
  if (!write.can) {
    return {
      ...base,
      // «Не смогли спросить» — не «нельзя»: сетевая заминка не повод объявлять
      // ключ негодным, право записи всё равно проверится на первом действии.
      ok: write.reason === "unknown",
      canWrite: false,
      reason: write.reason,
      message: write.message,
    };
  }
  return { ...base, ok: true, canWrite: true, reason: null, message: "Ключ умеет менять фото карточки — автоматическая смена доступна." };
}

/** Проверка текущего ключа кабинета либо нового, если его прислали. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession(["director"]);
  if (gate) return gate;

  const body = await request.json().catch(() => null) as { cabinetId?: string; token?: string; save?: boolean } | null;
  const cabinetId = String(body?.cabinetId ?? "").trim();
  if (!cabinetId || cabinetId === "all" || cabinetId.startsWith("group:")) return fail("Выберите один реальный кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);

  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return fail("Кабинет не найден", 404);

  const incoming = String(body?.token ?? "").trim();
  const current = resolveWbToken(cabinet, "content");
  const token = incoming || current;
  if (!token) return fail("У кабинета нет ключа контента, и новый не введён", 400);

  const verdict = await verify(token, Boolean(cabinet.token_content));

  // Сохраняем только то, что умеет писать: ключ на чтение и так уже стоит
  // в кабинете, класть его вторым экземпляром незачем.
  if (incoming && body?.save === true && verdict.canWrite) {
    const db = getSupabaseAdmin();
    if (!db) return fail("Supabase не настроен", 500);
    const { error } = await db.from("wb_cabinets").update({ token_content: incoming }).eq("id", cabinetId);
    if (error) return fail(`Не удалось сохранить ключ: ${error.message}`, 500);
    return NextResponse.json({ ...verdict, hasOwnKey: true, saved: true });
  }

  return NextResponse.json(verdict);
}
