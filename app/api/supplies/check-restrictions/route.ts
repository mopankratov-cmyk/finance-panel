import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Проверка ограничений складов отложена (зависит от WMS/Мандарин). Аккуратный
// JSON вместо HTML-404, чтобы интерфейс показал понятное сообщение.
export async function POST() {
  return NextResponse.json(
    { ok: false, deferred: true, detail: "Проверка ограничений складов отложена — WMS-интеграция не подключена.", checked: 0, nowhere: [] },
    { status: 200 },
  );
}
