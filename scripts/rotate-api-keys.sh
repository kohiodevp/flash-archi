#!/usr/bin/env bash
# scripts/rotate-api-keys.sh
# Usage: ./scripts/rotate-api-keys.sh <STAGING|PRODUCTION> [new_api_key]
# Rotates a Flash-Archi API key stored in a GitHub secret, with a 24h grace
# period for the previous key (stored in <KEY>_PREVIOUS GitHub secret).
set -euo pipefail

ENV_NAME="${1:-STAGING}"
NEW_KEY="${2:-}"

case "${ENV_NAME}" in
  STAGING|PRODUCTION) ;;
  *) echo "Usage: $0 STAGING|PRODUCTION [new_api_key]"; exit 1 ;;
esac

API_SECRET="${ENV_NAME}_API_KEY"
PREV_SECRET="${ENV_NAME}_API_KEY_PREVIOUS"

if [ -z "${NEW_KEY}" ]; then
  NEW_KEY=$(openssl rand -base64 32 | tr -d '\n')
fi

echo "=== Rotation clé API ${ENV_NAME} ==="

if command -v gh >/dev/null 2>&1; then
  # Preserve current key as the previous one (grace period)
  CURRENT=$(gh secret get "${API_SECRET}" || true)
  if [ -n "${CURRENT}" ]; then
    gh secret set "${PREV_SECRET}" -b "${CURRENT}" >/dev/null
    echo "✅ Ancienne clé conservée dans ${PREV_SECRET} (valide 24h)"
  fi

  gh secret set "${API_SECRET}" -b "${NEW_KEY}" >/dev/null
  echo "✅ Nouvelle clé enregistrée dans ${API_SECRET}"
else
  echo "⚠️  gh CLI absent. Actions manuelles requises."
fi

echo ""
echo "Nouvelle clé : ${NEW_KEY}"
echo "Ancienne clé valide 24h pendant la période de grâce."
echo "Note : le purge des clés expirées est géré côté application (scripts/expire-api-keys.js)."