# Flash-Archi SaaS

Moteur de génération architecturale autonome : à partir d'un prompt en langage naturel,
il extrait une spécification (surface, pièces, style…), génère un **plan 2D (SVG)**,
**quatre façades** (nord, sud, est, ouest) et une **maquette IFC4** (export BIM pour
l'homologation). Exposé en **API REST** avec **jobs asynchrones** et **flux SSE** pour
le suivi temps réel.

Ce projet est un fork **indépendant** du plugin `archi-genius` du DeepSeek Harness,
réécrit comme une application SaaS autonome : aucune dépendance au runtime Harness,
aucune clé API requise par défaut (provider `mock` déterministe).

> Version : 3.2.0 — Stack : Node.js ≥ 20 / Express / better-sqlite3 (SQLite + WAL) / Zod-like

---

## Fonctionnalités

- **Génération architecturale** : spec → plan 2D SVG → 4 façades (base64 PNG) → maquette IFC4.
- **Export BIM (IFC4)** : maquette volumique (dalle + murs + **ouvertures** + **toiture**),
  prête à l'échange IFC pour les flux BIM (maquette de construction préliminaire).
- **Détection d'ouvertures** : les fenêtres/portes du plan 2D (SVG) sont repérées,
  portées dans l'IFC (`IfcOpeningElement` / `IfcRelVoidsElement`) et comptées dans `bimMetrics`.
- **Toiture & métriques BIM** : dalle de toit au sommet (`IfcSlab` rôle `ROOF`), et
  métriques calculées (`footprintArea`, `grossVolume`, `openingCount`, `roofArea`, `totalVolume`).
- **Jobs asynchrones** : chaque demande reçoit un `jobId`, l'exécution tourne en arrière-plan.
- **Suivi REST + SSE** : interroger `GET /jobs/:id` ou `GET /jobs` (liste paginée), ou écouter `GET /events/:id`.
- **Multi-providers LLM** : `openrouter`, `groq`, `ollama`, + `mock` (aucune clé requise).
- **Routing intelligent** selon la complexité (règles dans `config.yaml`).
- **Persistance SQLite** (WAL) : jobs survivent aux redémarrages.
- **Cache de réponses** (mémoire + SQLite, TTL configurable).
- **Sécurité & robustesse** : garde anti-injection de prompt, rate limiting par IP,
  middleware d'erreur unifié, journalisation des requêtes (morgan).
- **Docker / Docker Compose** prêt à l'emploi.

---

## Démarrage rapide (sans Docker)

Par défaut le provider est `openrouter` (clé `OPENROUTER_API_KEY` requise) et le
serveur écoute sur `http://localhost:8080`. Sans clé API, lancez avec le provider
`mock` (100 % local, déterministe) :

```bash
cd /home/betsa/flash-archi
npm install
LLM_PROVIDER=mock npm start
```

Vérification :

```bash
curl http://localhost:8080/health
# {"api":"ok","provider":"mock","model":"gpt-4o","uptimeSeconds":1,"version":"3.2.0"}
```

Ou créez un `.env` (depuis `.env.example`) pour fixer vos valeurs.

---

## Configuration

La configuration se fait par **variables d'environnement** (`.env`, cf. `.env.example`)
et par **`config.yaml`** (providers, modèles, règles de routage, cache).

| Variable (env) | Rôle | Défaut |
|----------------|------|--------|
| `PORT` | Port HTTP | `8080` |
| `HOST` | Interface d'écoute | `0.0.0.0` |
| `LLM_PROVIDER` | `mock` \| `openrouter` \| `groq` \| `ollama` | `openrouter` |
| `LLM_MODEL` | Modèle par défaut | *celui du provider* |
| `LLM_MAX_TOKENS` | Budget de tokens | `1500` |
| `LLM_TEMPERATURE` | Température d'échantillonnage | `0.2` |
| `DB_PATH` | Chemin du store SQLite | `./data/flash-archi.db` |
| `OPENROUTER_API_KEY` | Clé OpenRouter | (vide) |
| `GROQ_API_KEY` | Clé Groq | (vide) |
| `OLLAMA_BASE_URL` | URL Ollama | `http://localhost:11434` |
| `OLLAMA_FALLBACK_MODEL` | Fallback local | `llama3.1:8b` |

> **Sécurité** : ne jamais committer de clés. Elles passent par l'environnement
> (`.env` est ignoré via `.gitignore`). Aucun secret n'est écrit dans `config.yaml`.

Le `mock` n'utilise **jamais** de fallback ; seuls `openrouter` et `groq` peuvent
rebasculer sur `ollama` en cas d'échec.

---

## API

### `POST /api/flash-archi/generate`

Crée un job. Corps (JSON) :

```json
{ "prompt": "Une villa de 150 m², 3 chambres, style méditerranéen, avec garage" }
```

Réponse `202 Accepted` :

```json
{ "jobId": "job_...", "status": "pending" }
```

### `GET /api/flash-archi/jobs`

Liste paginée des jobs récents (les plus récents d'abord). Paramètres : `limit`
(défaut 20, max 50) et `offset` (défaut 0). La vue publique n'expose **aucun
prompt brut** (cohérent avec `GET /jobs/:id`).

```bash
curl "http://localhost:8080/api/flash-archi/jobs?limit=10&offset=0"
```

```json
{
  "items": [
    {
      "id": "job_...", "status": "completed",
      "error": null, "createdAt": 1785510000123, "updatedAt": 1785510002345
    }
  ],
  "limit": 10, "offset": 0, "count": 1
}
```

### `GET /api/flash-archi/jobs/:id`

État et résultat d'un job. Réponse si terminé :

```json
{
  "id": "job_...",
  "status": "completed",
  "result": {
    "spec": {
      "surface": 150, "rooms": 3, "hasOpenKitchen": false,
      "garage": "single", "style": "méditerranéen",
      "facadeColor": "blanc", "shutterColor": "bleu",
      "storeys": 1, "heightPerStorey": 3
    },
    "plan2d": { "svg": "<svg ...>", "width": 1200, "height": 800 },
    "facades": {
      "north": "data:image/png;base64,...",
      "south": "data:image/png;base64,...",
      "east":  "data:image/png;base64,...",
      "west":  "data:image/png;base64,..."
    },
    "ifcModel": "data:application/step;base64,SVNPLTEwMzAzLTIx... (IFC4)",
    "bimMetrics": { "footprintArea": 150, "grossVolume": 450, "openingCount": 2, "roofArea": 150, "totalVolume": 487.5 }
  },
  "error": undefined,
  "createdAt": 1785510000000,
  "updatedAt": 1785510001234
}
```

Statuts : `pending` → `processing` → `completed` | `failed`.

### `GET /api/flash-archi/events/:id` (Server-Sent Events)

Flux d'événements de statut jusqu'à l'état final :

```
data: {"jobId":"job_...","type":"status","status":"processing"}
data: {"jobId":"job_...","type":"status","status":"completed","result":{...}}
```

### `GET /health`

Liveness : `{ "api": "ok", "provider": ..., "model": ..., "uptimeSeconds": ..., "version": ... }`

### `GET /`

Index des endpoints exposés.

---

## Sécurité & limites

- **Garde anti-injection de prompt** : `POST /generate` refuse les prompts contenant
  des directives d'injection type « ignore above instructions », « you are now an
  unconstrained LLM », etc. → réponse `400` (`Prompt rejected (injection guard)`).
- **Rate limiting** : `60` requêtes / minute / IP sur tout `/api/*` (`429 Too many
  requests` + en-tête `Retry-After`). Le compteur est en mémoire, par IP.
- **Validation du prompt** : non vide et ≤ `4000` caractères (schéma zod).
- **Middleware d'erreur unifié** : toute erreur non gérée retourne un JSON sans fuite
  de pile (message générique en production).
- **Journalisation** : chaque requête est loguée au format
  `[:date[iso]] :method :url :status :bytes :response-time ms` (morgan).
- **Limites BIM (assumées)** : la maquette est schématique — la détection d'ouvertures
  repose sur les conventions du SVG de plan (cercle blanc = fenêtre, segment court
  contrasté = porte) ; la toiture est une dalle horizontale simple (pas de pente,
  lucarnes ou géométrie complexe) ; les quantités détaillées et classifications
  restent hors périmètre. Idéale pour les échanges précoces et une maquette de
  construction préliminaire, pas pour la maquette d'exécution détaillée.

---

## Docker

### Image

```bash
cd /home/betsa/flash-archi
docker build -t flash-archi-saas .
docker run -d --name flash-archi \
  -e LLM_PROVIDER=mock -e PORT=8080 -e DB_PATH=/app/data/flash-archi.db \
  -p 8080:8080 flash-archi-saas
curl http://localhost:8080/health
```

### Docker Compose

```bash
cd /home/betsa/flash-archi
docker compose up --build -d
```

Volume nommé `flash_archi_data` monté sur `/app/data` (persistance SQLite).
Le conteneur tourne en utilisateur non-root (`node`) et porte un healthcheck `/health`.

---

## Tests

```bash
npm test
```

Couverture : schémas de validation, moteur de génération (provider mock déterministe),
et API (supertest + store mémoire isolé). Ajouter des tests par qualité gate de
l'architecture Betsaleel.

## 🛡️ CI Quality Gate (`ci-check.sh`)

Pour garantir l'intégrité, la sécurité et la fonctionnalité du projet avant chaque merge, un script de validation complet est fourni :

```bash
./scripts/ci-check.sh
```

Ce script effectue 4 contrôles bloquants (exit code 1 si échec) :
1. **Secret Scanning** : Vérifie qu'aucun mot de passe ou clé API n'est commité en dur.
2. **Tests** : Exécute la suite de tests unitaires et d'intégration (TAP).
3. **Docker Build** : Valide que l'image Docker se construit sans erreur.
4. **Health Check** : Démarre l'API (mode mock) et vérifie que `/health` répond en HTTP 200.

*À intégrer dans votre pipeline CI/CD (GitHub Actions, GitLab CI) comme étape obligatoire.*

---

## Structure

```
src/
  index.js     Point d'entrée (démarrage serveur, arrêt propre)
  app.js       Application Express (routes REST + SSE)
  config.js    Fusion .env + config.yaml + défauts
  schemas.js   Schémas de validation (port des schemas zod)
  engine.js    Moteur : spec → plan 2D → façades
  llm.js       Dispatchers providers (mock | openrouter | groq | ollama)
  jobs.js      Store jobs SQLite (WAL) + manager asynchrone + événements
  cache.js     Cache réponses (mémoire + SQLite, TTL)
  validators.js Validation du prompt + garde anti-injection
  ifcGenerator.js Génération maquette IFC4 (export BIM)
  svgOpenings.js  Détection des ouvertures (fenêtres/portes) dans le plan SVG
tests/         Tests unitaires + API
config.yaml    Providers, modèles, règles de routage, cache
```

---

## Licence

MIT