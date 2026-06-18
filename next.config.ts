import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // undici подключается в серверном роуте /api/agent для проксирования запросов
  // к Anthropic — не бандлим его, грузим как внешний модуль Node.
  serverExternalPackages: ["undici", "@higgsfield/client"],
  // Кокпит — статический HTML: не кэшировать, чтобы правки доезжали сразу (вендор-JS кэшируется как обычно)
  async headers() {
    return [
      { source: "/inferno/patrick.html", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      { source: "/inferno/wb.html", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
