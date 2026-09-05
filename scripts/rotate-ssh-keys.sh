#!/usr/bin/env bash
# scripts/rotate-ssh-keys.sh
# Usage: ENV=staging|production ./scripts/rotate-ssh-keys.sh
# Generates a new ed25519 key pair, installs the public key on the server,
# and stores the new private key in the corresponding GitHub secret.
set -euo pipefail

ENV_NAME="${1:-staging}"

case "${ENV_NAME}" in
  staging)   GH_SECRET="STAGING_SSH_KEY";  SERVER_VAR="STAGING_HOST";  USER_VAR="STAGING_USER" ;;
  production) GH_SECRET="PROD_SSH_KEY";     SERVER_VAR="PROD_HOST";     USER_VAR="PROD_USER" ;;
  *) echo "Usage: $0 staging|production"; exit 1 ;;
esac

# Resolve host/user from the environment (they must be exported)
SERVER=${!SERVER_VAR:-}
SSH_USER=${!USER_VAR:-}
if [ -z "${SERVER}" ] || [ -z "${SSH_USER}" ]; then
  echo "❌ Missing variables: export ${SERVER_VAR} and ${USER_VAR} first."
  exit 1
fi

KEY_DIR="${HOME}/.ssh"
NEW_KEY="${KEY_DIR}/github-actions-${ENV_NAME}-new"
DATE_TAG=$(date +%Y%m%d)

echo "=== Rotation clé SSH ${ENV_NAME} ==="
ssh-keygen -t ed25519 -C "github-actions-${ENV_NAME}-${DATE_TAG}" -f "${NEW_KEY}" -N "" -q
echo "✅ Nouvelle clé générée : ${NEW_KEY}.pub"

ssh-copy-id -i "${NEW_KEY}.pub" "${SSH_USER}@${SERVER}" >/dev/null
echo "✅ Clé publique installée sur ${SSH_USER}@${SERVER}"

if command -v gh >/dev/null 2>&1; then
  gh secret set "${GH_SECRET}" -f "${NEW_KEY}" >/dev/null
  echo "✅ GitHub secret ${GH_SECRET} mis à jour"
else
  echo "⚠️  gh CLI absent. Importez manuellement ${NEW_KEY} dans le secret ${GH_SECRET}."
fi

echo ""
echo "=== Terminé ==="
echo "Ancienne clé à supprimer manuellement de ${SSH_USER}@${SERVER}:~/.ssh/authorized_keys"
echo "Fichier temporaire à supprimer après vérification : ${NEW_KEY}"