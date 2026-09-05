# Flash-Archi — API publique & documentation

> Pré-production (3.3.0). API publique sous `/api/public/v1`, API interne de
> versioning sous `/api/flash-archi/projects/:projectId/versions`.
> Documentation interactive (Swagger UI) : `GET /api/docs`.

---

## Authentification

Toutes les requêtes de l'API publique nécessitent une **clé API Bearer** :

```
Authorization: Bearer <votre_cle_api>
```

- Clé résolue par **tenant** (plan `free` / `pro` / `enterprise`).
- Chaque endpoint exige un **scope** `public:*` (voir par endpoint).
- L'API interne (`/api/flash-archi/**`, versions) utilise la clé applicative
  `API_KEY` (variable d'environnement) — réservé au backend.

### Scopes

| Scope                    | Accès                                            |
|--------------------------|--------------------------------------------------|
| `public:read:projects`   | Lire les projets                                 |
| `public:write:projects`  | Créer/modifier les projets                       |
| `public:read:jobs`       | Lire l'état des jobs                             |
| `public:write:jobs`      | Lancer une génération                            |
| `public:read:artifacts`  | Récupérer les artefacts d'un job terminé         |
| `public:manage:webhooks` | Gérer les abonnements webhook                    |

Clé manquante/malformée → `401`. Clé valide mais scope insuffisant → `403`.

---

## Rate limiting

Quota par clé API, **fenêtre glissante de 60 s** :

| Plan        | Limite      | Endpoints        |
|-------------|-------------|------------------|
| Free        | 100 req/min | Tous             |
| Pro         | 500 req/min | Tous             |
| Enterprise  | 1000 req/min| Tous             |

Chaque réponse porte :

| Header               | Signification                                  |
|----------------------|------------------------------------------------|
| `X-RateLimit-Limit`  | Quota de la fenêtre                            |
| `X-RateLimit-Remaining` | Requêtes restantes dans la fenêtre          |
| `X-RateLimit-Reset`  | Timestamp (ms) de réinitialisation             |
| `Retry-After`        | Secondes avant retry (sur `429`)               |

Dépassement → `429` avec les mêmes headers.

---

## Endpoints API publique (`/api/public/v1`)

### Projets

| Méthode | Route                  | Scope                    | Description            |
|---------|------------------------|--------------------------|------------------------|
| GET     | `/projects`            | `public:read:projects`   | Lister (RLS par tenant)|
| POST    | `/projects`            | `public:write:projects`  | Créer                 |
| GET     | `/projects/{projectId}`| `public:read:projects`   | Lire                  |

### Jobs

| Méthode | Route                               | Scope                   | Description            |
|---------|-------------------------------------|-------------------------|------------------------|
| POST    | `/projects/{projectId}/jobs`        | `public:write:jobs`     | Lancer une génération  |
| GET     | `/jobs/{jobId}`                     | `public:read:jobs`      | État d'un job          |
| GET     | `/jobs/{jobId}/artifacts`           | `public:read:artifacts` | Artefacts (job terminé)|

Statuts job : `pending`, `running`, `completed`, `failed`.

### Webhooks — `public:manage:webhooks`

| Méthode | Route                      | Description                              |
|---------|----------------------------|------------------------------------------|
| POST    | `/webhooks`                | Créer (le **secret n'est retourné qu'une fois**) |
| GET     | `/webhooks`                | Lister (sans secret)                     |
| GET     | `/webhooks/{webhookId}`    | Lire (sans secret)                       |
| PATCH   | `/webhooks/{webhookId}`    | Modifier (`url`, `events`, `active`)     |
| DELETE  | `/webhooks/{webhookId}`    | Supprimer → `204`                        |

### Événements disponibles

| Événement         | Déclenchement                 |
|-------------------|-------------------------------|
| `job.completed`   | Un job arrive à `completed`   |
| `job.failed`      | Un job passe à `failed`       |
| `project.created` | Projet créé                   |
| `project.updated` | Projet modifié                |

### Vérification de la signature HMAC-SHA256

Chaque livraison webhook porte des headers :

```
X-Webhook-Event:     <event_type>
X-Webhook-Signature: hex(HMAC-SHA256(secret, corps_json))
X-Webhook-Id:        <delivery_id>
X-Webhook-Timestamp: <iso8601>
```

Côté receveur, pour vérifier :

```bash
# Payload brut = corps JSON tel que reçu (ex. payload.json)
expected=$(printf '%s' "$(cat payload.json)" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
actual=$(curl -s -i ... | grep -i x-webhook-signature | awk '{print $2}')
[ "$expected" = "$actual" ] && echo "SIGNATURE VALIDE" || echo "SIGNATURE INVALIDE"
```

En JS :

```javascript
const crypto = require('node:crypto');
function verify(secret, payload, signature) {
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

> ⚠️ Comparer via `crypto.timingSafeEqual` (pas `==`) pour éviter les attaques
> temporelles.

### Politique de retry

| Tentative | Délai avant nouvel essai |
|-----------|--------------------------|
| 1         | immédiat                 |
| 2         | 1 s                      |
| 3         | 5 s                      |
| 4 (max)   | 30 s → échec définitif   |

- Échec après 4 tentatives → `status = failed` sur la delivery.
- Deliveries `success`/`failed` purgées après 7 jours.

---

## Endpoints API interne — Versions (`/api/flash-archi`)

Authentification : Bearer `API_KEY` (applicative).

| Méthode | Route                                                              | Description                  |
|---------|--------------------------------------------------------------------|------------------------------|
| GET     | `/projects/{projectId}/versions`                                   | Lister                       |
| POST    | `/projects/{projectId}/versions`                                   | Créer une version            |
| GET     | `/projects/{projectId}/versions/{versionId}`                       | Lire                         |
| POST    | `/projects/{projectId}/versions/{versionId}/restore`               | Restaurer (409 si collaboration active) |
| GET     | `/projects/{projectId}/versions/{versionA}/compare/{versionB}`     | Comparer deux versions       |

---

## Erreurs

| Code | Signification                                              |
|------|------------------------------------------------------------|
| 400  | Requête invalide (payload, validation)                     |
| 401  | Authentification échouée / clé manquante                   |
| 403  | Scope insuffisant                                          |
| 404  | Ressource introuvable (ou hors du tenant — RLS volontaire) |
| 409  | Conflit (ex. rollback bloqué)                              |
| 429  | Rate limit dépassé                                         |

Toutes les erreurs : `{"error": "..."}` + éventuel champ `details`.

> 👀 **RLS** : une ressource d'un autre tenant répond `404` (pas `403`) pour
> éviter toute fuite sur l'existence de ressources.

---

## Exemples

### 1. Créer un projet puis lancer une génération

```bash
# Créer
curl -s -X POST http://localhost:8080/api/public/v1/projects \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Villa","prompt":"Maison de 120 m²","parameters":{"levels":1}}'

# Lancer une génération
curl -s -X POST http://localhost:8080/api/public/v1/projects/<id>/jobs \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"prompt":"Extension de 20 m²"}'
# -> 202 {"jobId":"...","status":"pending"}

# Suivre
curl -s http://localhost:8080/api/public/v1/jobs/<jobId> \
  -H "Authorization: Bearer $KEY"

# Récupérer les artefacts une fois terminé
curl -s http://localhost:8080/api/public/v1/jobs/<jobId>/artifacts \
  -H "Authorization: Bearer $KEY"
```

### 2. S'abonner à un webhook

```bash
curl -s -X POST http://localhost:8080/api/public/v1/webhooks \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://hooks.example.com/fa","events":["job.completed","job.failed"]}'
# -> 201 {"id":"...","secret":"<À CONSERVER>"} — le secret n'est plus récupérable ensuite.
```

### 3. Vérifier la signature d'un webhook (à la réception)

```javascript
// secret obtenu à la création
const crypto = require('node:crypto');
const secret = '<SECRET>';
const signature = req.headers['x-webhook-signature'];
const body = req.body; // JSON brut
const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
const ok = signature && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
```

---

## Sandbox standalone

Sans PostgreSQL, mode mémoire autonome :

```bash
USE_MEMORY_DB=true AUTH_ENABLED=false LLM_PROVIDER=mock node src/index.js
```

Clés de test (seed mémoire) :

| Clé                         | Tenant | Scopes                                |
|-----------------------------|--------|---------------------------------------|
| `fa_test_public_pro`        | 1      | Tous `public:*` (pro)                |
| `fa_test_public_readonly`   | 2      | lectures projets/jobs/artefacts (free)|
| `fa_test_public_webhooks_t2`| 2      | `public:manage:webhooks` (free)      |

Swagger UI : `http://localhost:8080/api/docs`