import * as http from "http";
import * as https from "https";
import * as tls from "tls";
import * as net from "net";

export interface NmStatRow {
  date: string;         // YYYY-MM-DD
  ordersSumRub: number; // Заказали на сумму, руб (из NM-статистики карточек)
}

interface NmReportCard {
  statistics?: {
    selectedPeriod?: {
      ordersSumRub?: number;
      [k: string]: unknown;
    };
  };
  [k: string]: unknown;
}

interface NmReportDay {
  dt?: string;
  ordersSumRub?: number;
  [k: string]: unknown;
}

function analyticsToken(): string {
  return (
    process.env.WB_TOKEN_ANALYTICS ??
    process.env.WB_STATS_TOKEN ??
    process.env.WB_TOKEN_STATISTICS ??
    ""
  );
}

function agentProxyUrl(): string {
  return process.env.AGENT_PROXY_URL ?? "";
}

/**
 * HTTPS запрос через HTTP CONNECT прокси (без npm-пакетов).
 * Используется для geo-ограниченных WB Analytics endpoints.
 */
async function fetchViaProxy(
  targetUrl: string,
  proxyUrl: string,
  options: { method: string; headers: Record<string, string>; body: string },
): Promise<{ status: number; json: () => Promise<unknown> }> {
  const target = new URL(targetUrl);
  const proxy = new URL(proxyUrl);
  const proxyPort = parseInt(proxy.port) || 80;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("proxy timeout")), 10000);

    // Шаг 1: TCP соединение с прокси
    const socket = net.connect(proxyPort, proxy.hostname, () => {
      // Шаг 2: HTTP CONNECT туннель
      socket.write(
        `CONNECT ${target.hostname}:443 HTTP/1.1\r\n` +
        `Host: ${target.hostname}:443\r\n` +
        `\r\n`,
      );
    });

    socket.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    let connectBuf = "";
    socket.on("data", function onData(chunk: Buffer) {
      connectBuf += chunk.toString();
      if (!connectBuf.includes("\r\n\r\n")) return;
      socket.removeListener("data", onData);

      if (!connectBuf.startsWith("HTTP/1.1 200") && !connectBuf.startsWith("HTTP/1.0 200")) {
        clearTimeout(timeout);
        reject(new Error(`Proxy CONNECT failed: ${connectBuf.split("\r\n")[0]}`));
        return;
      }

      // Шаг 3: TLS поверх туннеля
      const tlsSocket = tls.connect(
        { socket, servername: target.hostname, rejectUnauthorized: true },
        () => {
          // Шаг 4: HTTPS запрос
          const path = target.pathname + target.search;
          const bodyBuf = Buffer.from(options.body, "utf8");
          const headersStr = Object.entries({
            ...options.headers,
            Host: target.hostname,
            "Content-Length": String(bodyBuf.length),
            Connection: "close",
          })
            .map(([k, v]) => `${k}: ${v}`)
            .join("\r\n");

          tlsSocket.write(
            `${options.method} ${path} HTTP/1.1\r\n` +
            `${headersStr}\r\n` +
            `\r\n`,
          );
          tlsSocket.write(bodyBuf);

          let rawResponse = "";
          tlsSocket.on("data", (d: Buffer) => { rawResponse += d.toString(); });
          tlsSocket.on("end", () => {
            clearTimeout(timeout);
            const [head, ...bodyParts] = rawResponse.split("\r\n\r\n");
            const statusLine = head.split("\r\n")[0];
            const status = parseInt(statusLine.split(" ")[1]) || 0;
            const bodyText = bodyParts.join("\r\n\r\n");
            resolve({
              status,
              json: async () => JSON.parse(bodyText),
            });
          });
          tlsSocket.on("error", (e: Error) => {
            clearTimeout(timeout);
            reject(e);
          });
        },
      );
      tlsSocket.on("error", (e: Error) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  });
}

/**
 * Получает ordersSumRub по дням из WB NM-report detail API.
 * Использует прокси (AGENT_PROXY_URL) если задан — endpoint geo-ограничен.
 * Возвращает пустой массив если токен не настроен или нет доступа.
 */
export async function fetchNmOrderStats(
  dateFrom: string,
  dateTo: string,
  refresh = false,
): Promise<NmStatRow[]> {
  const token = analyticsToken();
  if (!token) return [];

  const body = JSON.stringify({
    brandNames: [],
    objectIDs: [],
    tagIDs: [],
    nmIDs: [],
    timezone: "Europe/Moscow",
    period: {
      begin: `${dateFrom} 00:00:00`,
      end: `${dateTo} 23:59:59`,
    },
    orderBy: { field: "ordersSumRub", mode: "desc" },
    page: 1,
  });

  const url = "https://seller-analytics-api.wildberries.ru/api/v2/nm-report/detail";
  const headers: Record<string, string> = {
    Authorization: token,
    "Content-Type": "application/json",
  };

  try {
    let res: { status: number; json: () => Promise<unknown> };

    const proxy = agentProxyUrl();
    if (proxy) {
      res = await fetchViaProxy(url, proxy, { method: "POST", headers, body });
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const httpRes = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
          cache: refresh ? "no-store" : undefined,
        } as RequestInit);
        res = { status: httpRes.status, json: () => httpRes.json() };
      } finally {
        clearTimeout(timer);
      }
    }

    if (res.status !== 200) {
      if (res.status !== 401 && res.status !== 403 && res.status !== 404) {
        console.warn("[opiu] nm-report HTTP", res.status);
      }
      return [];
    }

    const data = (await res.json()) as {
      data?: { cards?: NmReportCard[]; isNextPage?: boolean };
    };

    const rows: NmStatRow[] = [];
    for (const card of data.data?.cards ?? []) {
      const history = (card as { history?: NmReportDay[] }).history;
      if (Array.isArray(history)) {
        for (const day of history) {
          const d = String(day.dt ?? "").slice(0, 10);
          if (d >= dateFrom && d <= dateTo) {
            const existing = rows.find((r) => r.date === d);
            if (existing) {
              existing.ordersSumRub += day.ordersSumRub ?? 0;
            } else {
              rows.push({ date: d, ordersSumRub: day.ordersSumRub ?? 0 });
            }
          }
        }
      } else {
        const sum = card.statistics?.selectedPeriod?.ordersSumRub ?? 0;
        if (sum > 0) {
          const existing = rows.find((r) => r.date === dateFrom);
          if (existing) existing.ordersSumRub += sum;
          else rows.push({ date: dateFrom, ordersSumRub: sum });
        }
      }
    }
    return rows;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("[opiu] nm-report timeout");
    } else {
      console.warn("[opiu] nm-report fetch error:", err);
    }
    return [];
  }
}
