# Раннер Gitea Actions в HOST-режиме с Node/git/curl/jq на борту.
# Host-режим = шаги workflow выполняются прямо в этом контейнере (без Docker-in-Docker).
# Поэтому всё, что нужно гейту и деплою (node/git/curl/jq), ставим прямо в образ.
#
# Сборка:  docker build -t finance-gitea-runner -f runner.Dockerfile .
# Регистрация выполняется энтрипоинтом по env (см. ниже / docker-compose.yml / README).

FROM node:20-bookworm-slim

ARG ACT_RUNNER_VERSION=0.2.11
ARG TARGETARCH=amd64

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl jq ca-certificates bash \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /usr/local/bin/act_runner \
      "https://gitea.com/gitea/act_runner/releases/download/v${ACT_RUNNER_VERSION}/act_runner-${ACT_RUNNER_VERSION}-linux-${TARGETARCH}" \
 && chmod +x /usr/local/bin/act_runner

WORKDIR /data

# Энтрипоинт: один раз регистрируется на инстансе (по токену регистрации), затем демонит.
# ENV (задаются в compose / .env):
#   GITEA_INSTANCE_URL          — https://<твой-gitea-домен>
#   GITEA_RUNNER_REGISTRATION_TOKEN — из Gitea: Site Admin → Actions → Runners → Create registration token
#   GITEA_RUNNER_NAME           — имя (опц., по умолчанию hostname)
#   GITEA_RUNNER_LABELS         — метки; ВАЖНО: host-режим, метка `gate` → `gate:host`
COPY runner-entrypoint.sh /usr/local/bin/runner-entrypoint.sh
RUN chmod +x /usr/local/bin/runner-entrypoint.sh

ENV GITEA_RUNNER_LABELS=gate:host
ENTRYPOINT ["/usr/local/bin/runner-entrypoint.sh"]
