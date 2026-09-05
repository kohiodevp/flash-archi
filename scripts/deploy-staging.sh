#!/usr/bin/env bash
# scripts/deploy-staging.sh
# Idempotent staging deployment helper (used by the CI workflow and locally).
# Usage: ./scripts/deploy-staging.sh
set -euo pipefail

cd /opt/flash-archi

# Save current tag for deterministic rollback before pulling the new image
CURRENT_TAG=$(docker compose config --format json | jq -r '.services.api.image' 2>/dev/null | cut -d: -f2 || true)
if [ -n "${CURRENT_TAG}" ] && [ "${CURRENT_TAG}" != "null" ]; then
  echo "${CURRENT_TAG}" > .previous-image-tag
  echo "Previous image tag saved: ${CURRENT_TAG}"
fi

echo "=== Déploiement staging ==="
docker compose pull
docker compose up -d --remove-orphans

echo "--- Attente des services healthy ---"
sleep 30
docker compose ps | grep -q "healthy" || {
  echo "❌ Un service n'est pas healthy après 30s"
  exit 1
}

echo "--- Migrations DB ---"
docker compose run --rm api npm run migrate:up

echo "✅ Déploiement staging terminé"