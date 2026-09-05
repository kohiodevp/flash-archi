#!/usr/bin/env bash
# scripts/package.sh — Packager Flash-Archi en ZIP (hors node_modules/data) + checksum
# Usage : VERSION=<x.y.z> ./scripts/package.sh  (ou lit package.json)
set -euo pipefail

VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
OUT_DIR="${OUT_DIR:-dist}"
DEST="${OUT_DIR}/flash-archi-${VERSION}.zip"

mkdir -p "${OUT_DIR}"
rm -f "${DEST}" "${DEST}.sha256"

# Liste explicite : source, tests, config, scripts, docs. Hors node_modules et data.
zip -r -q "${DEST}" \
  src \
  tests \
  scripts \
  data/.gitkeep \
  README.md SECURITY.md RUNBOOK.md ARCHITECTURE.md BACKUP_RESTORE.md CHANGELOG.md \
  .env.example .gitignore .dockerignore Dockerfile docker-compose.yml config.yaml \
  package.json package-lock.json \
  -x "node_modules/*" "data/*.db" "data/*.db-*" "dist/*" "backups/*" \
  -x "scripts/*.tmp" 2>/dev/null || true

sha256sum "${DEST}" > "${DEST}.sha256"

echo "Packaged: ${DEST}"
cat "${DEST}.sha256"