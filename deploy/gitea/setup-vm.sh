#!/usr/bin/env bash
# Подготовка Yandex Cloud Compute VM (Ubuntu 22.04) и запуск форжа.
# Идемпотентно: можно гонять повторно. Запускать ИЗ папки стека (где docker-compose.yml и .env).
#
#   ssh <user>@<vm-ip>
#   cd ~/gitea-stack && cp .env.example .env && nano .env   # заполнить домен/почту/пароль БД
#   bash setup-vm.sh
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "НЕТ .env — скопируй .env.example в .env и заполни (GITEA_DOMAIN, ACME_EMAIL, GITEA_DB_PASSWORD)"; exit 1
fi

# 1) Docker + compose-плагин (официальный репозиторий)
if ! command -v docker >/dev/null 2>&1; then
  echo "[setup] ставлю Docker…"
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER" || true
  echo "[setup] Docker поставлен (для работы без sudo может потребоваться перелогин)"
else
  echo "[setup] Docker уже есть"
fi

# 2) (опц.) локальный фаервол — основной всё равно security group в Yandex Cloud
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 22/tcp  || true
  sudo ufw allow 80/tcp  || true
  sudo ufw allow 443/tcp || true
fi

DC="docker compose"
$DC version >/dev/null 2>&1 || DC="sudo docker compose"

# 3) Поднять caddy+gitea+db (раннер — отдельно, после получения registration token)
echo "[setup] запускаю caddy + gitea + db…"
$DC up -d caddy gitea db

echo
echo "[setup] Готово. Открой https://$(grep -E '^GITEA_DOMAIN=' .env | cut -d= -f2-)"
echo "[setup] Дальше: установка Gitea → выключить регистрацию → Admin → Actions → Runners →"
echo "        создать registration token → вписать RUNNER_TOKEN в .env → $DC up -d runner"
