export function resolveFactoryOrigin(fallbackOrigin: string): string {
  const configured = String(process.env.BASE_URL || "").trim();
  const raw = configured || String(fallbackOrigin || "").trim();
  return raw.replace(/\/+$/, "");
}
