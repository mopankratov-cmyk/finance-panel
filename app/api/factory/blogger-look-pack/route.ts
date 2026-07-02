import { NextResponse } from "next/server";
import { buildKatyaLookPack } from "@/lib/factory/bloggerLookPack";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const pack = buildKatyaLookPack();
  return NextResponse.json({
    ...pack,
    note: "Dry-run only. Static look-pack for Katya visual expansion and anchor-preserving tests.",
  }, { headers: { "Cache-Control": "no-store" } });
}
