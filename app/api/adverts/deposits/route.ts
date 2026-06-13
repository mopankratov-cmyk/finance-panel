import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// История пополнений кампании. WB-история пополнений (/adv/v1/upd) + запись своих пополнений
// относятся к управлению рекламой (write-токен) — отложено. Пустой список, чтобы клик не падал 404.
export async function GET() {
  return NextResponse.json({ deposits: [] });
}
