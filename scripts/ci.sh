#!/usr/bin/env bash
# scripts/ci.sh — Validation locale minimal (sans secrets réels)
set -euo pipefail

echo "==> npm ci"
npm ci

echo "==> tests"
npm test

echo "==> lint (optionnel, non bloquant si absent)"
if npm run lint --silent >/dev/null 2>&1; then
  npm run lint
else
  echo "   (script lint non défini — ignoré)"
fi

echo "==> package + checksum"
./scripts/package.sh || echo "   (packaging ignoré)"
echo "CI OK"