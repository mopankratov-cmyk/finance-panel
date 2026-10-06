import { isIP } from "node:net";

/**
 * Адреса, куда серверный загрузчик модуля ходить не должен (ТЗ §11): внутренние
 * сети, петля, link-local и метаданные облака, CGNAT, multicast, служебные
 * диапазоны. Проверка идёт по уже разрешённому IP, а не по имени хоста.
 */
function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function inV4Range(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** IPv6 → 16 байт; null — не разобрался. Понимает `::`, зону (%eth0) и хвост с IPv4 (::ffff:10.0.0.1). */
function ipv6Bytes(address: string): number[] | null {
  let ip = address.toLowerCase().split("%")[0];
  const tail = ip.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const octets = tail.slice(2).map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n > 255)) return null;
    ip = `${tail[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...Array<string>(Math.max(0, missing)).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]);
}

const v4Of = (bytes: number[]) => bytes.join(".");

function isBlockedV6(bytes: number[]): boolean {
  const zeros = (from: number, to: number) => bytes.slice(from, to).every((b) => b === 0);
  // ::, ::1 и «IPv4-совместимые» ::a.b.c.d — внутреннее решает IPv4-часть.
  if (zeros(0, 12)) return bytes.slice(12).every((b) => b === 0) || isBlockedAddress(v4Of(bytes.slice(12)));
  // IPv4, упакованный в IPv6 (::ffff:7f00:1 = ::ffff:127.0.0.1), в любой записи.
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return isBlockedAddress(v4Of(bytes.slice(12)));
  // NAT64 64:ff9b::/96 — шлюз донесёт запрос до IPv4-адреса из последних 32 бит; 64:ff9b:1::/48 (локальный NAT64) — целиком.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    if (zeros(4, 12)) return isBlockedAddress(v4Of(bytes.slice(12)));
    if (bytes[4] === 0x00 && bytes[5] === 0x01) return true;
  }
  // 6to4 2002::/16 — IPv4 в байтах 2–5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return isBlockedAddress(v4Of(bytes.slice(2, 6)));
  // Teredo 2001:0::/32 — туннель, адрес назначения не проверить; документация 2001:db8::/32; discard 100::/64.
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return true;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && zeros(2, 8)) return true;
  const head = (bytes[0] << 8) | bytes[1];
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 — уникальные локальные
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 — link-local
  if ((head & 0xffc0) === 0xfec0) return true; // fec0::/10 — устаревшие site-local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 — multicast
  return false;
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return BLOCKED_V4.some(([base, bits]) => inV4Range(address, base, bits));
  if (version === 6) {
    const bytes = ipv6Bytes(address);
    return bytes === null ? true : isBlockedV6(bytes);
  }
  return true; // не IP вовсе — не пускаем
}
