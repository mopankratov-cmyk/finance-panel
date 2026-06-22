# Remotion render-worker в контейнере. Зеркалит render-service/bootstrap.sh:
#   те же системные либы Chrome Headless Shell + тот же package.deploy.json + те же ассеты.
# Образ — основа для масштаба: гонять на бо́льшей VM или во флоте/автоскейл-группе.
#
# Сборка ИЗ КОРНЯ репо (контекст = корень, т.к. нужны remotion/ и public/):
#   docker build -f render-service/Dockerfile -t factory-render .
# Запуск:
#   docker run --rm -p 8080:8080 --env-file .env.local factory-render
# Тюнинг скорости — через env (см. шапку server.mjs): RENDER_FRAME_CONCURRENCY, RENDER_OFFTHREAD_THREADS, RENDER_SCALE…

FROM node:22-bookworm-slim

# 1. системные либы для Chrome Headless Shell (тот же список, что в bootstrap.sh; libasound2 — имя в bookworm)
RUN apt-get update -y && apt-get install -y --no-install-recommends \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 \
      libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 \
      libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 fonts-liberation \
      ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# 2. slim-зависимости (тот же манифест, что на VM) — отдельным слоем ради кеша
COPY render-service/package.deploy.json ./package.json
RUN npm install --no-audit --no-fund

# 3. вшиваем Chrome Headless Shell в образ, чтобы не качать на холодном старте
#    (если сборочная сеть не пускает CDN — убери строку, тогда браузер скачается при первом рендере)
RUN node --input-type=module -e "import('@remotion/renderer').then(m=>m.ensureBrowser())"

# 4. исходники композиции + ассеты + сервис (то же, что кладёт make-bundle.sh)
COPY remotion ./remotion
COPY public/fonts ./public/fonts
COPY public/reel-assets ./public/reel-assets
COPY render-service/server.mjs ./render-service/server.mjs

# 5. HEALTHCHECK — bundled:true означает, что бандл прогрет и сервис готов рендерить
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=4 \
  CMD curl -fs "http://localhost:${PORT:-8080}/health" | grep -q '"ok":true' || exit 1

EXPOSE 8080
# сервис греет бандл при старте (getServeUrl) → первый рендер не платит за бандл
CMD ["node", "render-service/server.mjs"]
