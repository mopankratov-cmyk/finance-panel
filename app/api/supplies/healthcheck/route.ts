import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// WMS-проверка цепочки поставок отложена (см. docs/отложено.md). Возвращаем
// аккуратный JSON, чтобы интерфейс показал понятное сообщение, а не падал на HTML-404.
export async function GET() {
  return NextResponse.json({
    ok: false,
    deferred: true,
    checks: [
      { name: "WMS-интеграция", ok: false, detail: "Проверка конвейера отложена — складская интеграция (WMS/Мандарин) пока не подключена." },
    ],
  });
}
