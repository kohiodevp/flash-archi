#!/usr/bin/env bash
# scripts/rollback-prod.sh
# Manual rollback of Flash-Archi production to a specific previous image.
# Usage: ./scripts/rollback-prod.sh <version>
set -euo pipefail

APP_DIR="/opt/flash-archi"
REGISTRY="ghcr.io/flash-archi/flash-archi"
NEW_VERSION="${1:?Usage: $0 <version>}"

cd "${APP_DIR}"
echo "=== Rollback production vers ${REGISTRY}:${NEW_VERSION} ==="

docker compose down || true
docker compose up -d "${REGISTRY}:${NEW_VERSION}"

sleep 30
if curl -sf https://flash-archi.com/healthz > /dev/null; then
  echo "✅ Healthz OK après rollback vers ${NEW_VERSION}"
else
  echo "❌ Healthz KO après rollback vers ${NEW_VERSION}"
  exit 1
fi