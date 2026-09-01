import { NextRequest, NextResponse } from "next/server";

import { auditAdvertOperation, resolveAdvertCabinetContext } from "@/lib/adverts/cabinetGuard";
import { getMinusPhrases, setMinusPhrases } from "@/lib/wb/advertApi";

export const dynamic = "force-dynamic";

const MODES = ["add", "remove", "replace"] as const;
type Mode = (typeof MODES)[number];

function readPhrases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const phrase = item.trim();
    // Регистр у WB значения не имеет, а вот дубли в наборе — лишний вес против
    // лимита в 1000 фраз, поэтому схлопываем их здесь.
    if (phrase) seen.add(phrase.toLowerCase());
  }
  return [...seen];
}

async function currentPhrases(token: string, advertId: number, nmId: number) {
  const result = await getMinusPhrases(token, [{ advertId, nmId }]);
  if (!result.ok) return { error: result.message, phrases: [] as string[] };
  const row = (result.data.items ?? []).find((item) => item.advert_id === advertId && item.nm_id === nmId);
  return { error: null, phrases: readPhrases(row?.norm_queries) };
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const advertId = Number(params.get("advertId"));
  const nmId = Number(params.get("nmId"));
  if (!Number.isInteger(advertId) || advertId <= 0) return NextResponse.json({ error: "Нужен advertId" }, { status: 400 });
  if (!Number.isInteger(nmId) || nmId <= 0) return NextResponse.json({ error: "Нужен nmId" }, { status: 400 });

  const resolved = await resolveAdvertCabinetContext({ cabinetId: params.get("cabinet"), advertIds: [advertId] });
  if (resolved.response) return resolved.response;

  const current = await currentPhrases(resolved.context.token, advertId, nmId);
  if (current.error) return NextResponse.json({ error: current.error }, { status: 502 });
  return NextResponse.json({ advertId, nmId, phrases: current.phrases.sort() });
}

/**
 * Минус-фразы. Режимы `add` и `remove` существуют не для удобства, а как
 * защита от тихой потери данных.
 *
 * WB заменяет весь набор присланным: метод set-minus не знает слова «добавить».
 * Прямая отправка одной новой фразы стирает все накопленные, а пустой массив
 * стирает набор целиком — и то и другое проходит успешно, с кодом 200 и без
 * единого признака, что что-то пропало. Поэтому add/remove здесь сначала
 * читают текущий набор, считают новый и только потом пишут.
 *
 * Режим `replace` оставлен явным: заменить весь набор — законное действие, но
 * человек должен выбрать его сам, а не получить как побочный эффект.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const advertId = Number(body.advertId);
  const nmId = Number(body.nmId);
  const mode = (typeof body.mode === "string" ? body.mode : "add") as Mode;
  const phrases = readPhrases(body.phrases);

  if (!Number.isInteger(advertId) || advertId <= 0) return NextResponse.json({ error: "Нужен advertId" }, { status: 400 });
  if (!Number.isInteger(nmId) || nmId <= 0) return NextResponse.json({ error: "Нужен nmId" }, { status: 400 });
  if (!MODES.includes(mode)) return NextResponse.json({ error: "Неизвестный режим" }, { status: 400 });
  if (mode !== "replace" && !phrases.length) {
    return NextResponse.json({ error: "Не переданы фразы" }, { status: 400 });
  }

  const resolved = await resolveAdvertCabinetContext({ cabinetId: body.cabinetId, advertIds: [advertId] });
  if (resolved.response) return resolved.response;
  const context = resolved.context;

  const current = await currentPhrases(context.token, advertId, nmId);
  // Не прочитали текущий набор — не пишем вовсе. Слепая запись здесь означает
  // «заменить неизвестно что на присланное», то есть потерю без следа.
  if (current.error) {
    return NextResponse.json(
      { error: `Не удалось прочитать текущие минус-фразы, запись отменена: ${current.error}` },
      { status: 502 },
    );
  }

  let next: string[];
  if (mode === "add") next = [...new Set([...current.phrases, ...phrases])];
  else if (mode === "remove") next = current.phrases.filter((phrase) => !phrases.includes(phrase));
  else next = phrases;

  if (next.length > 1000) {
    return NextResponse.json({ error: `WB держит не больше 1000 минус-фраз, получилось ${next.length}` }, { status: 400 });
  }
  if (next.length === current.phrases.length && next.every((phrase) => current.phrases.includes(phrase))) {
    return NextResponse.json({ ok: true, advertId, nmId, phrases: next.sort(), unchanged: true });
  }

  const result = await setMinusPhrases(context.token, advertId, nmId, next);

  await auditAdvertOperation({
    context,
    advertId,
    action: "minus",
    status: result.ok ? "ok" : "error",
    oldValue: { nmId, count: current.phrases.length, phrases: current.phrases },
    newValue: { nmId, mode, count: next.length, phrases: next },
    wbResult: result.ok ? result.data : result.raw ?? result.message,
  });

  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status === 0 ? 500 : 502 });
  return NextResponse.json({ ok: true, advertId, nmId, phrases: next.sort(), was: current.phrases.length, now: next.length });
}
