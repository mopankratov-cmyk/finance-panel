import { timingSafeEqual } from "node:crypto";

/**
 * Узкая машинная дверь для импорта банковских выписок из почтового workflow.
 * Секрет отделён от CRON_SECRET: утечка учётных данных почтовой автоматизации
 * не должна давать доступ ко всем внутренним cron-роутам панели.
 */
export function isEmailStatementImportRequest(request: Request): boolean {
  const secret = process.env.DDS_EMAIL_IMPORT_SECRET;
  if (!secret || secret.length < 32) return false;

  const authorization = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const actualBytes = Buffer.from(authorization);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length
    && timingSafeEqual(actualBytes, expectedBytes);
}
