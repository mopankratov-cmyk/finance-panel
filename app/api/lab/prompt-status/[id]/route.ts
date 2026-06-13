import { NextResponse } from "next/server";
import { getTask } from "@/lib/lab/promptStore";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const t = getTask(id);
  if (!t) return NextResponse.json({ status: "pending", progress: "ждём…" });
  if (t.status === "error") return NextResponse.json({ status: "error", error: t.error });
  return NextResponse.json({ status: "done", prompt: t.prompt, audit: t.audit, age_sec: Math.round((Date.now() - t.createdAt) / 1000) });
}
