import { NextRequest, NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/sync/helpers";
import { runWbHistoryRecovery } from "@/lib/wb/syncRecovery";

// DETAIL_HISTORY_REPORT может включать десятки тысяч дневных строк и требует
// больше минуты на скачивание, распаковку и запись в Supabase.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const result = await runWbHistoryRecovery();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
