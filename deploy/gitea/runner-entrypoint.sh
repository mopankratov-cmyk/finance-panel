#!/usr/bin/env bash
# Регистрирует act_runner на инстансе Gitea (один раз) и запускает демон.
# Состояние регистрации хранится в /data/.runner — держи /data на персистентном томе!
set -euo pipefail

: "${GITEA_INSTANCE_URL:?нужен GITEA_INSTANCE_URL=https://<gitea-домен>}"
LABELS="${GITEA_RUNNER_LABELS:-gate:host}"
NAME="${GITEA_RUNNER_NAME:-$(hostname)}"
# capacity = сколько задач параллельно (деплой не должен блокировать гейт; capacity=1 это делал).
CAP="${GITEA_RUNNER_CAPACITY:-3}"

cd /data

if [ ! -f /data/.runner ]; then
  : "${GITEA_RUNNER_REGISTRATION_TOKEN:?нужен GITEA_RUNNER_REGISTRATION_TOKEN (Gitea → Admin → Actions → Runners)}"
  echo "[runner] регистрируюсь на $GITEA_INSTANCE_URL с метками: $LABELS"
  act_runner register --no-interactive \
    --instance "$GITEA_INSTANCE_URL" \
    --token "$GITEA_RUNNER_REGISTRATION_TOKEN" \
    --name "$NAME" \
    --labels "$LABELS"
else
  echo "[runner] уже зарегистрирован (/data/.runner) — пропускаю регистрацию"
fi

# Минимальный конфиг: параллелизм (capacity) + host-режим (docker_host:"-", без Docker-сокета).
# generate-config НЕ используем — он навязывает Docker-исполнение и падает «Docker socket not found».
cat > /data/config.yaml <<CFG
runner:
  capacity: ${CAP}
container:
  docker_host: "-"
CFG

echo "[runner] capacity=${CAP}, host-режим, старт демона"
exec act_runner daemon --config /data/config.yaml
