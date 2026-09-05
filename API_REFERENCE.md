# Flash-Archi API Reference

> Référence d'intégration frontend `flash-archi-frontend` ↔ API `flash-archi-saas`.
> **Fondée sur une lecture du code source** (`src/app.js`, `src/jobs.js`, `src/schemas.js`,
> `src/health.js`, `src/routes/public.js`) et de la spec `openapi/spec.yaml` — vérifiée le 2026-09-05.
> Tous les formats ci-dessous sont ceux réellement émis par le serveur (pas une reconstruction).

---

## 1. Authentification

- **Header** : `Authorization: Bearer <API_KEY>`
- **Clé** : variable d'environnement `API_KEY` (fichier `.env` du service).
- **Activation** : `AUTH_ENABLED=true` (sinon le middleware est by-passé).
- **Mode développement** : `AUTH_ENABLED=false` → aucune clé requise (ne JAMAIS exposer ainsi en prod).
- Les endpoints publics `/api/public/v1/**` ont LEUR PROPRE auth (clé publique Bearer + scopes) — voir §4.
- Retour sur clé absente/invalide : `401 { "error": "Missing or malformed Authorization header" | "Invalid API key" }`.

> **Note frontend** : il n'existe **aucun** endpoint dédié `verify-key`. La validation d'une clé se fait
> en appelant une route protégée simple — recommandé : `GET /api/flash-archi/jobs?limit=1` (401 si invalide).

---

## 2. Endpoints Internes (single-key, SQLite) — V1 / disponible dès aujourd'hui

### 2.1 Générer un plan — `POST /api/flash-archi/generate`

Soumet un prompt et crée un job **asynchrone** (réponse immédiate 202).

**Body (JSON)**
```json
{ "prompt": "Maison moderne 3 chambres, toit plat, orientation sud" }
```
Contraintes : `prompt` requis, non vide, ≤ 4000 caractères.

**Réponse — 202 Accepted**
```json
{ "jobId": "job_<uuid>", "status": "pending" }
```
- `status` initial : `"pending"` (statuts : `pending | processing | completed | failed`).
- Erreurs : `400` si prompt vide/invalide (mesage `check.details`).

**Exemple curl**
```bash
curl -X POST http://localhost:8080/api/flash-archi/generate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Maison moderne 3 chambres"}'
```

### 2.2 Suivi temps réel (SSE) — `GET /api/flash-archi/events/:jobId`

Flux Server-Sent Events qui suit le job jusqu'à `completed` ou `failed`.

- `Content-Type: text/event-stream`, keep-alive (`: keep-alive`) toutes les 20 s.
- **Un seul type d'événement émis** : `data: { "jobId", "type": "status", "status", "result"?, "error"? }`.
- Un état courant est envoyé immédiatement à l'ouverture du flux.
- Si le job est déjà terminé, le flux se ferme aussitôt après l'état initial.

**Exemple curl**
```bash
curl -N http://localhost:8080/api/flash-archi/events/<jobId> \
  -H "Authorization: Bearer $API_KEY"
```

> **Note frontend** : consommer ce flux via `EventSource` (GET natif) ou `fetch` SSE.
> Se connecter UNIQUEMENT tant que le job est `pending`/`processing` ; basculer sur
> `GET /jobs/:id` une fois terminé (le résultat y est plus lisible).

### 2.3 Détail d'un job — `GET /api/flash-archi/jobs/:jobId`

**Réponse — 200**
```json
{
  "id": "job_<uuid>",
  "status": "completed",
  "result": {
    "spec": { "surface": 120, "rooms": 3, "style": "contemporain" },
    "plan2d": { "svg": "<svg ...>", "scale": 50, "legend": "..." },
    "facades": { "north": "<png base64>", "south": "...", "east": "...", "west": "..." },
    "ifcModel": "data:application/step;base64,...",
    "bimMetrics": { "footprintArea": 120, "grossVolume": 360, "openingCount": 8, "roofArea": 130, "totalVolume": 360 }
  },
  "error": null,
  "createdAt": 1725548400000,
  "updatedAt": 1725548460000
}
```
Particularités (fidèles au code) :
- **Le champ `prompt` n'est PAS retourné** sur cette vue publique (`publicView`).
- `result.plan2d.svg` est une **chaîne SVG brute** (à injecter via `v-html`, voir sanitisation §6),
  `result.facades.*` sont des **PNG base64**, `ifcModel` un data-URI base64.
- `createdAt`/`updatedAt` : timestamps epoch **millisecondes**.
- `404` si le job n'existe pas.
- `status` peut être `pending | processing | completed | failed` (+ `error` si `failed`).

### 2.4 Historique des jobs — `GET /api/flash-archi/jobs`

Pagination : `?limit` (≤50) et `?offset`. **SANS les prompts** (métadonnées seules).

**Réponse — 200**
```json
{
  "items": [
    { "id": "job_<uuid>", "status": "completed", "error": null, "createdAt": 1725548400000, "updatedAt": 1725548460000 }
  ],
  "limit": 20,
  "offset": 0,
  "count": 1
}
```

**Exemple curl**
```bash
curl "http://localhost:8080/api/flash-archi/jobs?limit=10&offset=0" \
  -H "Authorization: Bearer $API_KEY"
```

---

## 3. Santé & Documentation

| Endpoint | Méthode | Réponse |
|---|---|---|
| `/health` | GET | `{ "api":"ok", "provider":"...", "model":"...", "uptimeSeconds":N, "version":"3.3.0" }` |
| `/healthz` | GET | alias de `/health` |
| `/readyz` | GET | `{ "status":"ready", "checks":{ "database":"ok" } }` (prêt à recevoir) |
| `/version` | GET | `{ "service":"flash-archi", "version":"3.3.0", "environment":"production" }` |
| `/api/docs` | GET | Swagger UI (spec `openapi/spec.yaml`) |

Tous-ci sont publics (servis avant le middleware d'auth).

---

## 4. Endpoints Publics Multi-Tenant — V2 (REQUIERT PostgreSQL + RLS)

> **NON DISPONIBLE pour la V1.** Ces routes sont protégées par `dbMiddleware` (transactions + RLS),
> donc tributaires d'une base Postgres connectée (config actuelle = SQLite). Documentation conservée
> pour préparer la V2 — ne pas coder le frontend V1 contre celles-ci, sauf si l'on anticipe la migration.

- **Auth** : `Authorization: Bearer <clé_publique>` + **scopes** par endpoint (`public:read:projects`,
  `public:write:jobs`, `public:read:artifacts`, `public:manage:webhooks`, `public:*:analytics`, ...).
  Plans : free=100 req/min, pro=500, enterprise=1000.
- **Modèle** : tout est lié à un **projet** (créer un projet, puis lancer des jobs dessus).

| Endpoint | Méthode | Rôle / scope |
|---|---|---|
| `/api/public/v1/projects` | GET/POST | Lister / créer (scope read/write projects) |
| `/api/public/v1/projects/{projectId}` | GET/PATCH/DELETE | Lire / modifier / supprimer |
| `/api/public/v1/projects/{projectId}/jobs` | POST | Lancer une génération (scope write jobs) → 202 `{jobId,status,projectId}` |
| `/api/public/v1/jobs/{jobId}` | GET | Lire l'état d'un job (scope read jobs) |
| `/api/public/v1/jobs/{jobId}/artifacts` | GET | Artefacts d'un job terminé (scope read artifacts) → 409 tant que non terminé |
| `/api/public/v1/webhooks[/{id}]` | GET/POST/PATCH/DELETE | Abonnements webhook (scope manage webhooks ; secret retourné une seule fois) |
| `/api/public/v1/analytics/*` | GET/PATCH | Snapshots / export / config (scope read/write analytics) |
| `/api/public/v1/admin/analytics/*` | GET | Agrippes admin multi-tenants (scope admin:analytics) |

**Artefacts** `/jobs/{jobId}/artifacts` → `{ jobId, items: [ {type, format, data} ... ] }` ; types :
`spec`(json) · `plan2d`(svg) · `facades`(png, flags north/south/east/west) · `ifc`(ifc4) · `bim_metrics`(json).

---

## 5. Déploiement (VPS / Docker)

- **Port interne** : `8080` (contraindre via env `PORT=8080` — le `.env` local porte 8081).
- **Image** : `node:20-alpine`, utilisateur non-root `app`, volume `/app/data`.
- **Healthcheck conteneur** : `GET /healthz` (OK si HTTP 2xx).
- **Réseau** : rattacher au réseau externe `npm-net` ; NPM reverse-proxy `/api/**` et `/health*` vers le conteneur API.
- **Nom DNS dans npm-net** : `flash-archi-api` (résolvable pour le proxy).

---

## 6. Notes sécurité / intégration frontend

- **Sanitisation SVG** : `plan2d.svg` vient d'une source non fiable (LLM). L'injecter avec
  `v-html` expose à du XSS si le contenu contient du script. Policy : ignorer `<script>`,
  `<foreignObject>`, attributs `on*` — ou rendre via `<img src="data:image/svg+xml;utf8...">` (pas d'exécution JS).
- **Clés API** : jamais dans le bundle JS ni en `localStorage` persistant (risque XSS). Session en
  `sessionStorage`, injectée par intercepteur Axios (Auth: Bearer) — déjà en place dans `src/api/client.ts`.
- **AUTH_ENABLED** : en production, toujours `true` + `API_KEY` longue et rotative (rotation 90 j).
- **Rate limiting** : 60 req/min/IP par défaut sur `/api/` — UI doit gérer `429` (`{error:"too_many_requests"}`).

---

### Changements requis backend pour la V2 (au-delà du frontend)
1. Postgres + migrations + RLS (présents dans `migrations/` — à activer) + pool `pg` configurable.
2. Endpoints **manquants** pour un dashboard multi-tenant : profil utilisateur/tenant, quota utilisation,
   agrégat de jobs par période. (Aucun n'existe aujourd'hui.)
3. Authentification & inscription self-service + délivrance de clés par scope.

---

## 7. Vérification empirique (2026-09-05, provider `mock`)

Contrat validé **par exécution réelle** (`PORT=8080 LLM_PROVIDER=mock node src/index.js`) :

- `POST /api/flash-archi/generate` → **202** `{"jobId":"job_1c278cc9-…","status":"pending"}`
- Cycle observé : `pending → completed` (< 1 s avec le moteur mock déterministe)
- `GET /api/flash-archi/jobs/job_*` → **200** avec `result` comportant exactement :
  - `spec` : `{surface, rooms, style, roof, facadeColor, shutterColor, storeys, heightPerStorey, …}`
  - `plan2d` : `{svg:"<svg …>", scale:50, legend:"…"}` — `svg` est bien une **chaîne SVG brute**
  - `facades` : `{north,south,east,west}` (PNG base64)
  - `bimMetrics` : `{footprintArea, grossVolume, openingCount, roofArea, totalVolume}`
  - `ifcModel` : data-URI base64 (`ifcModel` présent dans ce build)
- Index `GET /api/flash-archi/jobs?limit=3` → `{items:[…],limit,offset,count}` **sans prompts**,
  `createdAt`/`updatedAt` en epoch ms.
- Erreur provider (ex. `LLM_PROVIDER=seekai` indisponible) : `status:"failed"` avec `error` textuel
  chaîné (`Provider seekai échoué ; fallback Ollama échoué aussi : …`).

**Bugs réels découverts pendant la vérification (à corriger côté API) :**
1. `src/health.js` : `require('better-sqlite3')` en contexte ESM → `/readyz` renvoyait toujours
   `database: error` (exception avalée par le `try/catch`). **CORRIGÉ** : import ESM `Database` —
   `/readyz` renvoie maintenant `{"status":"ready","checks":{"database":"ok"}}`.
2. `docker-compose.yml` : `EXPOSE 8094` (Dockerfile) incohérent avec `PORT` (8080/8081). Le compose
   force désormais `PORT=8080` et le healthcheck cible `/healthz` sur ce port.