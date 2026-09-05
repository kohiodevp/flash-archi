# Flash-Archi — Architecture

## Vue d'ensemble

Flash-Archi transforme une description textuelle d'un bâtiment en livrables
architecturaux : plan 2D (SVG), facades (PNG), maquette IFC4 (BIM) et métriques.

```
Client / curl / frontend
        │  HTTP (JSON)
        ▼
Reverse proxy (éventuel, TLS)
        │
        ▼
Express API (src/app.js)
  • auth API key      (src/auth.js)
  • rate limiting     (express-rate-limit)
  • logs JSON + reqId (Pino, src/logger.js, src/requestId.js)
  • health /healthz /readyz /version  (src/health.js)
        │
        ├─ create job → POST /api/flash-archi/generate
        │
        ▼
JobStore (SQLite via better-sqlite3, src/jobs.js)
        │
        ▼
Moteur de génération (src/engine.js)
  • extraction spec (LLM)
  • plan 2D SVG
  • facades PNG
  • IFC4 + détection ouvertures (src/ifcGenerator.js, src/svgOpenings.js)
  • métriques bimMetrics
        │
        ▼
Résultat persisté + suivi via GET /jobs/:id et SSE /events/:id
```

## Composants

| Module | Rôle |
|--------|------|
| `src/app.js` | Montage Express, middleware, routes |
| `src/engine.js` | Orchestration de la génération |
| `src/llm.js` | Providers LLM (openrouter, groq, ollama, mock) |
| `src/jobs.js` | Store jobs + file en mémoire + SSE |
| `src/cache.js` | Cache des appels LLM (mémoire) |
| `src/svgOpenings.js` | Détection d'ouvertures depuis le SVG |
| `src/ifcGenerator.js` | Génération IFC4 |
| `src/schemas.js`, `src/validators.js` | Validation (Zod-like) |
| `src/auth.js`, `src/logger.js`, `src/requestId.js`, `src/health.js` | Sécurité & observabilité |

## Flux de génération

1. `POST /generate` valide le prompt, crée un job.
2. Le moteur extrait la spec via le LLM.
3. Génère le plan 2D SVG, détecte les ouvertures.
4. Génère les facades PNG.
5. Génère la maquette IFC4 (dalles + murs + ouvertures + toiture).
6. Calcule les métriques, persiste le résultat.
7. Statut consultable par REST/SSE.

## Dépendances externes

- Provider LLM (via `src/llm.js`). Provider `mock` = aucune clé requise.
- SQLite (fichier, via `DB_PATH`).

## Limites actuelles

- Node.js single-thread ; la génération s'exécute dans le processus API.
- Base SQLite mono-fichier (pas encore multi-worker / multi-instance).
- Artefacts renvoyés en base64 dans le JSON (pas encore de stockage objet).
- Auth à clé unique (pas encore de multi-tenant ni de table de clés).

## Évolutions prévues

- Queue + worker séparé (BullMQ + Redis ou PgBoss).
- Migration PostgreSQL.
- Stockage des artefacts sur object storage avec URLs signées.
- Multi-tenancy, quotas, budgets LLM.