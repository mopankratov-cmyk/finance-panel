import { NextRequest, NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/sync/helpers";
import { runWbHistoryRecovery } from "@/lib/wb/syncRecovery";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const result = await runWbHistoryRecovery();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
