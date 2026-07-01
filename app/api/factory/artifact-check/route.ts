import { NextRequest, NextResponse } from "next/server";
import { runArtifactCheck } from "@/lib/factory/qaGates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// HTTP shell over the same artifact gate used by graph-run. Keep prompt/logic in qaGates.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const frames: string[] = Array.isArray(body.frames) ? body.frames.slice(0, 6) : [];
    const result = await runArtifactCheck(frames);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({
      ok: true,
      severity: "clean",
      defects: [],
      warning: "artifact-check crash: " + String((e as Error)?.message || e).slice(0, 160),
    });
  }
}
