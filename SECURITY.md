# Flash-Archi — Sécurité

Ce document décrit les mesures de sécurité minimales en place sur Flash-Archi et
les bonnes pratiques à suivre avant toute exposition publique.

## Authentification

- Toutes les routes `/api/*` sont protégées par une clé API.
- Mode activé avec `AUTH_ENABLED=true`.
- La clé attendue est lue depuis `API_KEY` (variable d'environnement).
- Le client fournit : `Authorization: Bearer <api_key>`.
- Réponses : `401` si header absent, mal formé ou clé invalide.
- **By-pass dev** : `AUTH_ENABLED=false` ou `NODE_ENV=test` désactivent la
  vérification (à réserver au développement local avec `provider=mock`).
- Fail-closed : une configuration absente ou invalide refuse l'accès.

### Bonnes pratiques clés

- Ne **jamais** committer `API_KEY`.
- Utiliser une clé forte (`openssl rand -hex 32`).
- En production : injecter `API_KEY` via le gestionnaire de secrets de l'hôte
  (Docker secrets, Vault, etc.), jamais dans un `.env` commité.

## Rate limiting

- `express-rate-limit` applique une limite globale sur `/api/*` (60 req/min/IP
  par défaut, réglable via `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`).
- En dépassement : `429` + `Retry-After`.
- Suggestion : une limite plus stricte sur `POST /generate` (ex. 5/h/clé).

## Gestion des secrets

- `.env` est réservé au développement local et ignoré par Git.
- Aucun secret réel ne doit apparaître dans les logs, la base, les prompts
  envoyés au modèle, ni dans les réponses API.
- Pino est configuré pour censurer les headers sensibles
  (`authorization`, `x-api-key`, `set-cookie`).

## Politique Hermes Agent (outils)

Principe : **DENY BY DEFAULT**.

- `HERMES_DENY_ALL_BY_DEFAULT=true` (défaut) : seuls les outils listés dans
  `HERMES_ALLOWED_TOOLS` (CSV) sont autorisés. Un outil inconnu ou non listé est
  refusé (fail-closed).
- `HERMES_DENIED_TOOLS` (mode alternatif, si `HERMES_DENY_ALL_BY_DEFAULT=false`)
  liste les outils explicitement refusés.
- Outils recommandés **interdits** par défaut : `terminal`, `browser_use`,
  `web_search`, `web_extract`, `write_file`, `patch`, `cronjob`,
  `skill_manage`, `memory`.
- Le LLM ne doit **jamais** décider librement d'exécuter un outil sensible sans
  contrôle applicatif (extraction/validation de sortie en amont).

## Ce qui est interdit

- Exécuter directement une instruction générée par le LLM.
- Laisser le LLM appeler `terminal` ou écrire des fichiers arbitraires.
- Logger les clés API, tokens ou prompts complets en production.
- Exposer `/healthz`, `/readyz`, `/version` à une authentification stricte
  (ils restent légers et publics par conception).

## Journalisation

- Logs **JSON structurés** (Pino) avec `requestId`.
- Événements tracés : requêtes HTTP, création/début/fin/échec de job, appels
  LLM, refus d'outils, erreurs.

## Signaler une vulnérabilité

Contactez l'équipe projet via le canal interne dédié, sans jamais publier de
preuve d'exploitation ni de données sensibles dans le ticket.
## Sécurité du pipeline CI/CD

Le pipeline GitHub Actions suit une politique de **deny-by-default** :

- **Actions pinnées par SHA** (pas de tags flottants) ; revue manuelle de toute
  action ajoutée.
- **Permissions minimales** par job (`contents: read` par défaut, droits élevés
  uniquement quand requis).
- **Tokens** : le `GITHUB_TOKEN` a le scope minimal ; les secrets de production
  sont scopés à l'environnement GitHub `production`.

### Signature des images (cosign)

- Toutes les images Docker sont **signées** avant publication avec cosign.
- La clé privée est chiffrée par une **passphrase forte** (≥ 32 caractères,
  générée avec `openssl rand -base64 32`) stockée dans les secrets GitHub.
- La clé publique `cosign.pub` est commitée ; toute image non signée est rejetée
  avant déploiement.
- **Rotation annuelle** : nouvelle paire de clés, mise à jour des secrets,
  nouvelle `cosign.pub`.

### Scans automatiques

- `npm audit --audit-level=high` à chaque PR.
- Scan **Trivy** (filesystem + image Docker) — fail si vulnérabilité
  `CRITICAL`/`HIGH`.
- **SBOM** généré à chaque release (`anchore/sbom-action`).
- **Dependabot** active pour npm / docker / github-actions ; auto-merge
  uniquement pour les mises à jour `patch`.
