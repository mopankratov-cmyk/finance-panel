#!/usr/bin/env bash
# Одна команда поднимает render-сервис на свежей Ubuntu-VM.
# Запуск из распакованного бандла:
#   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... REMOTION_RENDER_TOKEN=... bash render-service/bootstrap.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="$(id -un)"
cd "$APP_DIR"
echo "▶ APP_DIR=$APP_DIR  user=$RUN_USER"

# секреты: либо уже лежит .env.local (залит заранее, secret-safe), либо берём из env-переменных вызова
HAVE_ENV_FILE=0
if [ -f .env.local ] && grep -q '^SUPABASE_SERVICE_ROLE_KEY=' .env.local; then
  HAVE_ENV_FILE=1
  echo "▶ использую существующий .env.local"
else
  : "${NEXT_PUBLIC_SUPABASE_URL:?нужен NEXT_PUBLIC_SUPABASE_URL (или заранее залитый .env.local)}"
  : "${SUPABASE_SERVICE_ROLE_KEY:?нужен SUPABASE_SERVICE_ROLE_KEY}"
  : "${REMOTION_RENDER_TOKEN:?нужен REMOTION_RENDER_TOKEN}"
fi
PORT="${PORT:-8080}"

# 1. Node 22 (если нет ≥20)
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 20 ]; then
  echo "▶ ставлю Node 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# 2. системные либы для Chrome Headless Shell (Remotion)
echo "▶ ставлю системные либы Chrome…"
sudo apt-get update -y
sudo apt-get install -y libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2t64 \
  libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 \
  libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 fonts-liberation \
  || sudo apt-get install -y libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 \
       libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 \
       libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 fonts-liberation

# 3. зависимости (slim — без Next)
echo "▶ npm install (slim)…"
cp render-service/package.deploy.json package.json
npm install --no-audit --no-fund

# 4. .env.local (только если не залит заранее)
if [ "$HAVE_ENV_FILE" = "0" ]; then
  cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
REMOTION_RENDER_TOKEN=${REMOTION_RENDER_TOKEN}
PORT=${PORT}
RENDER_CONCURRENCY=${RENDER_CONCURRENCY:-1}
EOF
  echo "▶ .env.local записан"
fi

# 5. systemd-юнит (с реальным путём и юзером)
echo "▶ ставлю systemd-сервис…"
sudo tee /etc/systemd/system/remotion-render.service >/dev/null <<EOF
[Unit]
Description=Remotion render service (factory premium)
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
ExecStart=$(command -v node) --env-file=.env.local render-service/server.mjs
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now remotion-render

# 6. health (бандл греется при старте — ждём bundled:true)
echo "▶ жду готовности сервиса…"
for i in $(seq 1 30); do
  sleep 2
  if curl -fs "http://localhost:${PORT}/health" 2>/dev/null | grep -q '"bundled":true'; then
    echo "✅ render-сервис поднят: http://localhost:${PORT}/health"
    curl -s "http://localhost:${PORT}/health"; echo
    echo ""
    echo "Дальше: открой порт ${PORT} в Security Group, и задай в Vercel:"
    echo "  REMOTION_RENDER_URL=http://<публичный-IP-VM>:${PORT}"
    echo "  REMOTION_RENDER_TOKEN=<тот же токен>"
    echo "  FACTORY_RENDER_ENGINE=remotion"
    exit 0
  fi
done
echo "⚠ сервис не поднялся за 60с — смотри: journalctl -u remotion-render -e"
exit 1
