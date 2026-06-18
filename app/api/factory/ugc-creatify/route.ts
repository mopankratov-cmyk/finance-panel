import { NextRequest, NextResponse } from "next/server";
import { creatifyCreate, creatifyReady } from "@/lib/factory/creatify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// UGC-актёр Creatify (lipsyncs/Aurora): актёр говорит наш сценарий → видео 9:16. Async: task_id, статус опрашивать.
export async function POST(req: NextRequest) {
  if (!creatifyReady()) return NextResponse.json({ detail: "Creatify не подключён: добавь CREATIFY_API_ID и CREATIFY_API_KEY в Vercel env" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const script: string = (body.script || body.brief || body.hook || "").toString().trim();
  if (!script) return NextResponse.json({ detail: "Нужен текст/сценарий для актёра (script)" }, { status: 400 });
  const creator: string = (body.creator || "").toString().trim();

  const res = await creatifyCreate(script, { creator: creator || undefined });
  if (res.error || !res.token) return NextResponse.json({ detail: res.error || "Creatify не запустил" }, { status: 502 });
  return NextResponse.json({ task_id: "cf." + res.token, engine: "creatify" });
}
