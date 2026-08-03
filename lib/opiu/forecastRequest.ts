export class ForecastTimeoutError extends Error {
  constructor(message = "Расчёт занял слишком много времени. Повторите запрос.") {
    super(message);
    this.name = "ForecastTimeoutError";
  }
}

export async function runForecastWithin<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new ForecastTimeoutError();
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function readForecastJson<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      response.ok
        ? fallbackMessage
        : "Сервер прогноза временно недоступен. Повторите запрос через минуту.",
    );
  }

  if (!response.ok) {
    const message = payload && typeof payload === "object"
      && "error" in payload && typeof payload.error === "string"
      && payload.error.trim()
      ? payload.error
      : fallbackMessage;
    throw new Error(message);
  }

  return payload as T;
}
