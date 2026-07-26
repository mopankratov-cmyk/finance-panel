export interface ApiResponseEnvelope {
  error?: string;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export async function readApiResponse<T extends ApiResponseEnvelope>(
  response: Response,
  label = "API",
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = compactText(text).slice(0, 220);
    const vercelSecurityCheck = /vercel security check/i.test(snippet);
    const htmlDocument = /^<!doctype html/i.test(snippet) || /^<html/i.test(snippet);
    const genericPlatformError = /an error occurred/i.test(snippet);
    let detail: string;
    if (genericPlatformError || !snippet) {
      detail = `${label} вернул техническую ошибку HTTP ${response.status}. Обычно это таймаут или сбой serverless-функции, а не ошибка данных в браузере.`;
    } else if (vercelSecurityCheck) {
      detail = `${label} получил страницу защиты Vercel вместо данных. Обновите страницу и повторите запрос; если ошибка осталась после выката, проверьте, что запрос идёт на production-домен и cron/API не попали под Deployment Protection.`;
    } else if (htmlDocument) {
      detail = `${label} получил HTML-страницу вместо JSON. Обычно это защита/редирект платформы или устаревшая вкладка после деплоя; обновите страницу и повторите запрос.`;
    } else {
      detail = `${label} вернул не JSON: ${snippet}`;
    }
    return { error: detail } as T;
  }
}

export async function readOkApiResponse<T extends ApiResponseEnvelope>(
  response: Response,
  label = "API",
): Promise<T> {
  const body = await readApiResponse<T>(response, label);
  if (!response.ok || body.error) {
    throw new Error(body.error || `${label} вернул HTTP ${response.status}`);
  }
  return body;
}
