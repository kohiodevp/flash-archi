# Flash-Archi — Pipeline CI/CD

Ce document décrit le pipeline d'intégration et de déploiement continu mis en
place pour Flash-Archi (ticket P1-07). Il s'exécute sur **GitHub Actions**.

## Vue d'ensemble

```
PR ──► [Workflow A] PR Validation ──► merge sur main ──► [Workflow B] Staging Auto-Deploy
                                                            │
tag v*.*.* ──► [Workflow C] Production Release (approbation manuelle + blue/green)
                                                            │
1er du mois ──► [Rollback Drill] (workflow planifié)
```

## Workflow A — PR Validation

Fichier : `.github/workflows/pr-validation.yml`

- Trigger : `pull_request` vers `main`.
- Jobs : `lint`, `test` (PostgreSQL éphémère + migrations up/down/up), `security`
  (npm audit + Trivy fs), `build` (image Docker + scan Trivy).
- Tous les checks doivent passer pour merger (branch protection).

## Workflow B — Staging Auto-Deploy

Fichier : `.github/workflows/staging-deploy.yml`

- Trigger : push sur `main`.
- Étapes : `test` (réutilisé) → `build-push` (GHCR, tags `staging` +
  `staging-$SHA`, signé cosign) → `deploy-staging` (SSH, rollback déterministe via
  `.previous-image-tag`, migrations) → `smoke-test` → `e2e-tests` (Playwright) →
  `validate-staging` (échoue si smoke OU e2e échoue) → `rollback-on-failure` OU
  `notify`.

## Workflow C — Production Release

Fichier : `.github/workflows/production-release.yml`

- Trigger : tag `v*.*.*` poussé (généré par semantic-release).
- Étapes : `test` → `build-push` (tags `vX.Y.Z` + `latest`, signé cosign) →
  `load-test` (réduit) → `deploy-production` (**approbation manuelle**, 2
  reviewers, blue/green) → `smoke-test-prod` → `post-deploy-monitoring` →
  `cost-estimation` → `create-release` (semantic-release + SBOM).

## Workflows secondaires

- `.github/workflows/rollback-drill.yml` : test mensuel du rollback (cron `0 2 1 * *`).
- `.github/workflows/dependabot-auto-merge.yml` : auto-merge des updates `patch`.

## Load Tests en CI vs Manuels

- **CI (Workflow C)** : tests réduits — 10 min baseline (50 VUs) + 10 min burst
  (200 VUs) — pour validation rapide avant l'approbation production.
- **Manuels (P1-06)** : tests complets (60 min baseline + 20 min burst + 4h soak +
  stress) exécutés avant chaque release majeure (ex. v3.0.0, v4.0.0).

## Gestion des secrets

Voir le tableau d'inventaire dans le Design Document P1-07 (§4). Les secrets de
production sont scopés à l'environnement GitHub `production`.

## Sécurité du pipeline

- Actions pinnées par SHA ; permissions minimales par job.
- Images signées cosign (passphrase forte) ; vérification via `cosign.pub`.
- Dependabot pour npm / docker / github-actions.
- SBOM généré à chaque release.

## Rollbacks

- **Staging** : `.previous-image-tag` sauvegardé avant chaque déploiement ;
  `rollback-on-failure` restaure l'image précédente de façon déterministe.
- **Production** : `scripts/rollback-prod.sh <version>` (manuel).
- Drill mensuel pour valider la procédure.