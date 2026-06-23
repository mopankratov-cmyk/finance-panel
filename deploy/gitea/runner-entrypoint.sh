#!/usr/bin/env bash
# Регистрирует act_runner на инстансе Gitea (один раз) и запускает демон.
# Состояние регистрации хранится в /data/.runner — держи /data на персистентном томе!
set -euo pipefail

: "${GITEA_INSTANCE_URL:?нужен GITEA_INSTANCE_URL=https://<gitea-домен>}"
LABELS="${GITEA_RUNNER_LABELS:-gate:host}"
NAME="${GITEA_RUNNER_NAME:-$(hostname)}"

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

echo "[runner] старт демона"
exec act_runner daemon
