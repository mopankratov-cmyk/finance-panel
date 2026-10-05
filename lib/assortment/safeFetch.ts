import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { isIP } from "node:net";
import { isBlockedAddress } from "./netGuard";

/**
 * Серверная загрузка внешних страниц и картинок для модуля ассортимента.
 *
 * Защита по ТЗ §11: только http(s); адрес проверяется в момент подключения
 * (собственный lookup), поэтому ни редирект, ни подмена DNS не уведут запрос во
 * внутреннюю сеть или к метаданным облака; редиректы — вручную и не больше
 * трёх; лимит размера и времени; ответ — только данные, никакого исполнения.
 */
export class SafeFetchError extends Error {
  constructor(
    public readonly code: "bad_url" | "blocked_host" | "too_large" | "timeout" | "http_error" | "too_many_redirects" | "network",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  accept?: string;
  maxRedirects?: number;
  /**
   * Свой User-Agent. Обход каталогов представляется роботом честно: так сайт
   * сам решает по robots.txt, что нам отдавать. Lime 04.10 браузерному
   * заголовку включал проверку на бота (307 + куки), а роботу отдавал страницы.
   */
  userAgent?: string;
}

/** Честное имя робота модуля для обхода каталогов сайтов. */
export const ASSORTMENT_BOT_UA = "Mozilla/5.0 (compatible; FinancePanelAssortmentBot/1.0)";

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((entry) => isBlockedAddress(entry.address))) {
      const blocked = Object.assign(new Error(`Адрес ${hostname} ведёт во внутреннюю сеть`), { code: "EBLOCKED" });
      return callback(blocked, "");
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

function decode(stream: Readable, encoding: string | undefined): Readable {
  switch ((encoding ?? "").toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return stream.pipe(createGunzip());
    case "deflate":
      return stream.pipe(createInflate());
    case "br":
      return stream.pipe(createBrotliDecompress());
    default:
      return stream;
  }
}

function requestOnce(url: URL, options: SafeFetchOptions): Promise<{ status: number; location: string | null; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup as unknown as typeof dnsLookup,
        headers: {
          "User-Agent": options.userAgent ?? USER_AGENT,
          Accept: options.accept ?? "*/*",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en-GB,en;q=0.9",
        },
        timeout: options.timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location: response.headers.location ?? null, contentType: "", body: Buffer.alloc(0) });
          return;
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > options.maxBytes) {
          response.destroy();
          reject(new SafeFetchError("too_large", "Файл больше допустимого размера"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = decode(response, response.headers["content-encoding"]);
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            stream.destroy();
            response.destroy();
            reject(new SafeFetchError("too_large", "Файл больше допустимого размера"));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolve({ status, location: null, contentType: String(response.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
        stream.on("error", (error) => reject(new SafeFetchError("network", error.message)));
      },
    );
    request.on("timeout", () => request.destroy(new SafeFetchError("timeout", "Сайт не ответил вовремя")));
    request.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof SafeFetchError) return reject(error);
      if (error.code === "EBLOCKED") return reject(new SafeFetchError("blocked_host", error.message));
      reject(new SafeFetchError("network", error.message));
    });
    request.end();
  });
}

export function parsePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SafeFetchError("bad_url", "Ссылка не распознана");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SafeFetchError("bad_url", "Поддерживаются только ссылки http и https");
  if (url.username || url.password) throw new SafeFetchError("bad_url", "Ссылка с логином и паролем не принимается");
  if (url.port && !["80", "443"].includes(url.port)) throw new SafeFetchError("bad_url", "Нестандартный порт не принимается");
  // Адрес-литерал (127.0.0.1, [::1], 169.254.169.254, [::ffff:7f00:1]) Node подключает напрямую, не вызывая lookup, — проверка в
  // guardedLookup его не видит. WHATWG URL уже привёл десятичные и шестнадцатеричные записи (2130706433, 0x7f.1) к виду 127.0.0.1.
  // Эта же функция проверяет цель редиректа.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) throw new SafeFetchError("blocked_host", "Адрес ведёт во внутреннюю сеть");
  return url;
}

export async function safeFetch(raw: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  let url = parsePublicUrl(raw);
  const maxRedirects = options.maxRedirects ?? 3;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const result = await requestOnce(url, options);
    if (result.location) {
      url = parsePublicUrl(new URL(result.location, url).toString());
      continue;
    }
    if (result.status < 200 || result.status >= 300) {
      throw new SafeFetchError("http_error", `Сайт ответил ${result.status}`, result.status);
    }
    return { url: url.toString(), status: result.status, contentType: result.contentType, body: result.body };
  }
  throw new SafeFetchError("too_many_redirects", "Слишком много перенаправлений");
}
