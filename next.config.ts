import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // undici подключается в серверном роуте /api/agent для проксирования запросов
  // к Anthropic — не бандлим его, грузим как внешний модуль Node.
  serverExternalPackages: ["undici"],
};

export default nextConfig;
