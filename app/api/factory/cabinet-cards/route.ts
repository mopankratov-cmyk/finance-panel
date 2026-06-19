import { NextRequest, NextResponse } from "next/server";
import { fetchCabinetCards } from "@/lib/wb/cards";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Карточки кабинета через Content API: article + nm_id + name + цвет + ниша(subject).
// GET ?cabinet=<uuid> (напр. Retail Family = куртки NORVIA); без него — все активные.
export async function GET(req: NextRequest) {
  const cabinet = new URL(req.url).searchParams.get("cabinet") || null;
  const cards = await fetchCabinetCards(cabinet);
  if (!cards.length) return NextResponse.json({ error: "нет карточек/content-токена" }, { status: 404 });
  return NextResponse.json({ cabinet: cabinet ?? "all", count: cards.length, cards });
}
