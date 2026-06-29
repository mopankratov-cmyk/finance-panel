import { NextRequest, NextResponse } from "next/server";
import { remotionHealth, remotionReload } from "@/lib/factory/remotionRender";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (req.nextUrl.searchParams.get("form") === "1") {
    return new NextResponse(
      '<!doctype html><meta charset="utf-8"><title>Remotion reload</title><body style="font-family:system-ui;padding:24px;background:#111;color:#eee"><h1>Remotion service</h1><form method="post" action="/api/factory/remotion-service"><input type="hidden" name="reload" value="true"><button style="font:inherit;padding:10px 14px">Reload Remotion bundle</button></form></body>',
      { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    );
  }
  const health = await remotionHealth();
  return NextResponse.json({ action: "health", service: "remotion", ...health }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const contentType = req.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await req.json().catch(() => ({}))
    : Object.fromEntries((await req.formData().catch(() => new FormData())).entries());
  if (body.reload !== true && body.reload !== "true") {
    const health = await remotionHealth();
    return NextResponse.json({ action: "health", service: "remotion", ...health }, { headers: { "Cache-Control": "no-store" } });
  }
  const reload = await remotionReload();
  const health = reload.ok ? await remotionHealth() : null;
  return NextResponse.json({
    ok: reload.ok,
    action: "reload",
    service: "remotion",
    reload,
    health_after: health,
  }, { status: reload.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } });
}
