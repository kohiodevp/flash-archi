#!/usr/bin/env bash
# Backup SQLite via node (better-sqlite3 .backup) — pas de dépendance au binaire sqlite3.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/backup-db.js "$@"