# Flash-Archi — Processus de Release

Ce document explique le cycle de release de Flash-Archi (P1-07), basé sur
**Conventional Commits** et **semantic-release**.

## Convention de commits

| Préfixe | Impact | Exemple de version |
|---------|--------|--------------------|
| `feat:` | minor   | 3.3.0 → 3.4.0 |
| `fix:`  | patch   | 3.3.0 → 3.3.1 |
| `BREAKING CHANGE:` / `feat!: ` | major | 3.3.0 → 4.0.0 |
| `chore:`, `docs:`, `test:` | aucun | — |

## Cycle de release

1. **PR** → Workflow A valide lint, tests (avec migrations), sécurité, build.
2. **Merge sur `main`** → Workflow B déploie le staging (aucune release).
3. **`npx semantic-release`** (job `create-release` du Workflow C) :
   - Analyse les commits depuis le dernier tag.
   - Calcule la nouvelle version.
   - Met à jour `CHANGELOG.md` et `package.json`.
   - Crée le tag `vX.Y.Z` et la release GitHub.
4. **Tag poussé** → Workflow C : tests + build + load-test réduit → **approbation
   manuelle (2 reviewers)** → déploiement blue/green → smoke tests → monitoring
   post-déploy (30 min) → estimation de coût.

## Migration de base de données

- `npm run migrate:up` s'exécute automatiquement en staging et en production.
- Migrations **forward-only**. Les migrations irréversibles déclenchent une erreur
  dans `exports.down()` (voir `docs/` et les `migrations/`).
- **Breaking change irréversible** : signalé dans `CHANGELOG.md` (balise
  `⚠️ Breaking Changes`) avec instruction de sauvegarder la base avant upgrade.

## Signature des images

- Chaque image est signée avec cosign (clé privée + passphrase forte dans les
  secrets GitHub).
- `cosign.pub` (clé publique) est commitée dans le repo pour vérification.
- Rotation annuelle de la paire de clés.

## Vérifications après release

- `healthz` sur l'environnement cible.
- Taux 5xx < 5 % sur 30 min (post-deploy monitoring).
- Coût LLM mensuel estimé < 1000 $ (cost-estimation).

## Rôles

- **Auteur PR** : respecte la convention de commits.
- **Reviewers (production)** : 2 approvals obligatoires (tech lead + product owner).
- **Ops** : rollback manuel via `scripts/rollback-prod.sh <version>`.