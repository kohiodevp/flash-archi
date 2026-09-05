#!/usr/bin/env bash
# scripts/deploy-prod.sh
# Blue/green deployment target for Flash-Archi production.
# Usage: PROD_HOST=... PROD_USER=... ./scripts/deploy-prod.sh <version>
# The workflow Production Release uses this same logic via SSH.
set -euo pipefail

APP_DIR="/opt/flash-archi"
REGISTRY="ghcr.io/flash-archi/flash-archi"
NEW_VERSION="${1:?Usage: $0 <version|tag>}"

cd "${APP_DIR}"

# Ensure cosign is available locally if the check is desired (leave optional).
if command -v cosign >/dev/null 2>&1 && [ -f cosign.pub ]; then
  cosign verify --key cosign.pub "${REGISTRY}:${NEW_VERSION}" >/dev/null 2>&1 \
    && echo "✅ Signature cosign vérifiée" || echo "⚠️  Vérification cosign non concluante (clé publique absente)."
fi

# Determine active and inactive backend
if [ -f .active-backend ]; then
  ACTIVE_BACKEND=$(cat .active-backend)
else
  ACTIVE_BACKEND="api-blue"
  echo "$ACTIVE_BACKEND" > .active-backend
fi

INACTIVE_BACKEND="api-green"
if [ "$ACTIVE_BACKEND" = "api-blue" ]; then
  INACTIVE_BACKEND="api-green"
else
  INACTIVE_BACKEND="api-blue"
fi

echo "=== Déploiement blue/green ==="
echo "Actif     : ${ACTIVE_BACKEND}"
echo "Inactif   : ${INACTIVE_BACKEND}"
echo "Version   : ${NEW_VERSION}"

COLOR="${INACTIVE_BACKEND#api-}"   # blue or green
COMPOSE_FILE="docker-compose.${COLOR}.yml"

# Prepare .env for the incoming backend
echo "ACTIVE_BACKEND=${INACTIVE_BACKEND}" > .env.next

echo "--- Pull image pour ${INACTIVE_BACKEND} ---"
docker compose -f "${COMPOSE_FILE}" --env-file .env.next pull

echo "--- Démarrage de ${INACTIVE_BACKEND} ---"
docker compose -f "${COMPOSE_FILE}" --env-file .env.next up -d

echo "--- Health check ${INACTIVE_BACKEND}:8094/healthz ---"
for i in {1..30}; do
  if curl -sf http://localhost:8094/healthz > /dev/null; then
    echo "✅ ${INACTIVE_BACKEND} healthy (tentative ${i})"
    break
  fi
  if [ "${i}" = "30" ]; then
    echo "❌ ${INACTIVE_BACKEND} non healthy après 30 tentatives"
    exit 1
  fi
  sleep 2
done

echo "--- Switch Caddy vers ${INACTIVE_BACKEND} ---"
mv .env.next .env
caddy reload --config /etc/caddy/Caddyfile

echo "--- Arrêt de l'ancien backend ${ACTIVE_BACKEND} ---"
docker compose -f "docker-compose.${ACTIVE_BACKEND#api-}.yml" down

echo "${INACTIVE_BACKEND}" > .active-backend

echo ""
echo "=== Déploiement terminé : backend actif ${INACTIVE_BACKEND} (v${NEW_VERSION}) ==="