import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel pins framework requests to a deployment automatically, but not custom
  // client fetches. Expose the current deployment id so those requests can add
  // ?dpl= and stay compatible with the JavaScript version already open in a tab.
  env: {
    NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID ?? "",
  },
  // undici подключается в серверном роуте /api/agent для проксирования запросов
  // к Anthropic — не бандлим его, грузим как внешний модуль Node.
  serverExternalPackages: ["undici"],
};

export default nextConfig;
