import {
  brotliCompressSync,
  brotliDecompressSync,
  constants,
} from "node:zlib";

// Next/Vercel отклоняет один Data Cache item больше 2 МБ. Дашборды состоят из
// повторяющихся строк/ключей и хорошо сжимаются Brotli; base64 остаётся обычной
// сериализуемой строкой для unstable_cache.
export function encodeCompressedJson(value: unknown): string {
  const json = Buffer.from(JSON.stringify(value));
  return brotliCompressSync(json, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
  }).toString("base64");
}

export function decodeCompressedJson<T>(value: string): T {
  const json = brotliDecompressSync(Buffer.from(value, "base64")).toString("utf8");
  return JSON.parse(json) as T;
}
