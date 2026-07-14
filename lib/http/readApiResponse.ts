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
    const genericPlatformError = /an error occurred/i.test(snippet);
    const detail = genericPlatformError || !snippet
      ? `${label} вернул техническую ошибку HTTP ${response.status}. Обычно это таймаут или сбой serverless-функции, а не ошибка данных в браузере.`
      : `${label} вернул не JSON: ${snippet}`;
    return { error: detail } as T;
  }
}
