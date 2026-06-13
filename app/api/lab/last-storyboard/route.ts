import { NextResponse } from "next/server";
import { lastVideo } from "@/lib/lab/videoStore";

export const dynamic = "force-dynamic";

// Последняя задача сториборда (для восстановления состояния после перезагрузки).
export async function GET() {
  const t = lastVideo();
  if (!t) return NextResponse.json({ task_id: null });
  return NextResponse.json({ task_id: null, scenario_title: t.scenario_title, beats: t.beats, script: t.script });
}
