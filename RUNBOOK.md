# Flash-Archi — Runbook

Guide d'exploitation pour démarrer, surveiller, sauvegarder et dépanner le service.

## Démarrer le service (développement)

```bash
# Depuis la racine du projet
cp .env.example .env   # puis ajuster si besoin (LLM_PROVIDER=mock en local)
npm install
npm start               # ou `npm run dev` (reload automatique)
```

Le service écoute sur `http://localhost:8094` (réglable via `PORT`).

## Arrêter le service

- `Ctrl+C` dans le terminal du processus.
- En conteneur : `docker compose down` ou `docker stop <container>`.

## Vérifier la santé

```bash
curl -i http://localhost:8094/healthz   # processus vivant (200)
curl -i http://localhost:8094/readyz    # dépendances OK (200) / sinon 503
curl -i http://localhost:8094/version   # version + environnement
```

## Consommer l'API (avec auth activée)

```bash
curl -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"une maison 150m², 2 étages"}' \
  http://localhost:8094/api/flash-archi/generate
```

Suivre le job :

```bash
curl -H "Authorization: Bearer $API_KEY" \
  http://localhost:8094/api/flash-archi/jobs/<jobId>
```

## Voir les logs

- Dev : stdout du processus (format JSON si `LOG_FORMAT=json`).
- Si logs JSON : exporter vers un collecteur (Loki, Elastic, etc.) en production.

## Sauvegarder / restaurer

Voir `docs/BACKUP_RESTORE.md`.

```bash
DB_PATH=./data/flash-archi.db BACKUP_DIR=./backups node scripts/backup-db.js
DB_PATH=./data/flash-archi.db node scripts/restore-db.js ./backups/flash-archi-<ts>.db
```

## Déployer une version

- Builder l'image : `docker build -t flash-archi:<version> .`
- Lancer : `docker compose up -d` (adapter `docker-compose.yml`).

## Revenir à une version précédente

- Si déployé en conteneur : pointer vers une image taguée précédente
  (`flash-archi:<ancienne-version>`) et redémarrer.
- Toujours avoir un backup frais de la base avant un changement majeur.

## Diagnostic des erreurs courantes

| Symptôme | Cause probable | Action |
|----------|----------------|--------|
| `401` sur `/api/*` | Auth activée, clé absente/invalide | Vérifier `AUTH_ENABLED` et la valeur de `API_KEY` fournie au client |
| `429` | Rate limit dépassé | Attendre et relire le header `Retry-After`, ou réduire le volume |
| `readyz` = 503 | Base inaccessible / corrompue | Vérifier `DB_PATH`, les droits, restaurer depuis un backup |
| Job en échec | Provider LLM indisponible ou sortie invalide | Consulter `GET /jobs/:id`, lire `error`, vérifier `LLM_PROVIDER` |
| Crash au démarrage | Module natif `better-sqlite3` non compilé | Relancer `npm install` et vérifier la version de Node (≥ 20) |

## Incident base de données

1. Arrêter le service (évite les écritures).
2. Tenter `readyz` pour confirmer l'incident.
3. Restaurer le dernier backup valide (voir `docs/BACKUP_RESTORE.md`).
4. Redémarrer et vérifier `readyz`.
## Déploiements CI/CD

Le pipeline complet est décrit dans `docs/CI_CD.md`. Points d'exploitation clés :

- **Staging** est déployé automatiquement à chaque push sur `main` (Workflow B).
- **Production** est déployée à chaque tag `v*.*.*` (Workflow C) **après
  approbation manuelle** (2 reviewers).
- En cas d'échec des tests staging (smoke ou E2E), un **rollback automatique**
  restaure l'image précédente (tag sauvegardé dans `.previous-image-tag`).
- **Rollback manuel production** : `./scripts/rollback-prod.sh <version>`.
- **Drill mensuel** : premier jour du mois à 02:00 UTC, le pipeline teste le
  rollback staging automatiquement.

## Migrations de base de données

- `npm run migrate:up` s'exécute automatiquement pendant les déploiements
  staging et production.
- **Migrations forward-only** : ne jamais exécuter `migrate:down` en production.
- Une migration **irréversible** (ex. `TEXT` → `JSONB`) échoue en `down` ; en cas
  d'échec d'upgrade, **restaurer le backup DB pré-migration** puis relancer
  `migrate:up` (voir `docs/BACKUP_RESTORE.md`).

## Signature des images

- Chaque image Docker est signée avec **cosign** (passphrase forte).
- `cosign.pub` (clé publique) est commitée dans le repo.
- Rotation annuelle de la paire de clés (mettre à jour les secrets GitHub +
  nouvelle `cosign.pub`).
