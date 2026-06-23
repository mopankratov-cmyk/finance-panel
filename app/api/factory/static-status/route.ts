import { NextRequest, NextResponse } from "next/server";
import { remotionStatus } from "@/lib/factory/remotionRender";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Прокси статуса рендера статики для студии (браузер не ходит на render-VM напрямую — токен/CORS).
// GET ?id=<render-job-id> → { status: in_progress|done|error, videoUrl?(PNG), error?, retryable? }
export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ status: "error", error: "нужен id" }, { status: 400 });
  const s = await remotionStatus(id);
  return NextResponse.json(s);
}
