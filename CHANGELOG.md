# Changelog

Toutes les modifications notables de Flash-Archi.

## [3.3.0] - UNRELEASED

### Added

- **Authentification par clé API** (`AUTH_ENABLED` / `API_KEY`) : toutes les
  routes `/api/*` refusent les requêtes non authentifiées (401). By-pass
  réservé au dev (`NODE_ENV=test`, `AUTH_ENABLED=false`, provider `mock`).
- **Rate limiting robuste** via `express-rate-limit` sur `/api/*`
  (60 req/min/IP par défaut, 429 + `Retry-After`).
- **Logs structurés JSON (Pino)** avec `requestId` (`X-Request-ID`), censure
  des headers sensibles.
- **Endpoints de santé** : `GET /healthz`, `GET /readyz`, `GET /version`.
- **Politique Hermes Agent (DENY BY DEFAULT)** : allowlist via
  `HERMES_ALLOWED_TOOLS`, fail-closed sur tout outil non listé.
- **Scripts de backup/restauration SQLite** (`scripts/backup-db.js`,
  `scripts/restore-db.js`) + documentation.
- **Documentation** : `SECURITY.md`, `RUNBOOK.md`, `ARCHITECTURE.md`,
  `BACKUP_RESTORE.md`.

### Changed

- Remplacé `morgan` (logs texte) par Pino/Pino-HTTP (logs JSON).
- Durci l'accès API (auth + rate limiting).

### Security

- Désactivation par défaut des outils Hermes dangereux (`terminal`,
  `browser_use`, `web_search`, `web_extract`, `write_file`, `patch`,
  `cronjob`, `skill_manage`, `memory`).

## [3.2.0] - 2026-08-31

- Stabilisation du moteur de génération.
- Tests : 47/47 passants (avant ajout du socle sécurité).
- Génération SVG, PNG, IFC4 (dalles + murs + ouvertures + toiture), métriques.
- Suivi de jobs via API/SSE.
- Livraison ZIP vérifiée.