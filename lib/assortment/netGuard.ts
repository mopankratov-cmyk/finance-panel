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

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return BLOCKED_V4.some(([base, bits]) => inV4Range(address, base, bits));
  if (version === 6) {
    const ip = address.toLowerCase();
    if (ip === "::" || ip === "::1") return true;
    // IPv4, упакованный в IPv6 (::ffff:10.0.0.1), проверяем как IPv4.
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    const head = parseInt(ip.split(":")[0] || "0", 16);
    if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 — уникальные локальные
    if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 — link-local
    if ((head & 0xff00) === 0xff00) return true; // ff00::/8 — multicast
    return false;
  }
  return true; // не IP вовсе — не пускаем
}
