import { NextResponse } from "next/server";
import { countUsers } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

// Есть ли уже пользователи (для UX первого запуска — «Создать директора»).
export async function GET() {
  const n = await countUsers();
  // null — база не ответила. Показать «панель пустая, заведите директора» в
  // такой момент значит соврать: пользователи, скорее всего, есть.
  if (n === null) return NextResponse.json({ hasUsers: true, unknown: true });
  return NextResponse.json({ hasUsers: n > 0 });
}
