#!/usr/bin/env bash
# Собрать slim-бандл для деплоя render-сервиса на VM (без node_modules, без секретов, без Next-приложения).
# Запуск из корня репо: bash render-service/make-bundle.sh
set -euo pipefail
OUT="${1:-/tmp/remotion-render-bundle.tar.gz}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
tar -czf "$OUT" \
  remotion \
  public/fonts \
  public/reel-assets \
  scripts/render-local.mjs \
  render-service/server.mjs \
  render-service/package.deploy.json \
  render-service/bootstrap.sh \
  render-service/README.md
echo "✅ бандл: $OUT"
du -h "$OUT" | cut -f1 | xargs echo "размер:"
echo "содержимое:"; tar -tzf "$OUT" | sed 's/^/  /' | head -20
