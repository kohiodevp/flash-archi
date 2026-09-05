#!/usr/bin/env bash
# Restauration d'une sauvegarde SQLite via node.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/restore-db.js "$@"