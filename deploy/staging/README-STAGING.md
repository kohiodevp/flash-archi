# Flash-Archi Staging — Guide de déploiement

## Objectif

Déployer Flash-Archi 3.3.0 dans un environnement staging sécurisé, isolé, avec TLS, authentification, rate limiting, logs structurés et sauvegardes.

**Ce n'est pas une mise en production publique.**

---

## Prérequis

- Docker 20.10+
- Docker Compose 2.0+
- Domaine local ou certificat TLS (mkcert recommandé pour staging local)
- Accès aux variables d'environnement sécurisées

---

## Architecture

```
Client de test
     │
     ▼
Caddy (TLS, headers sécurité, reverse proxy)
     │
     ▼
API Flash-Archi 3.3.0
     │
     ├─► Volume data/ (flash-archi.db)
     └─► Volume backups/ (sauvegardes horaires)
```

---

## 1. Préparation

### 1.1. Cloner ou extraire le package

```bash
cd /path/to/flash-archi
```

### 1.2. Créer le fichier .env.staging

```bash
cd deploy/staging
cp .env.staging.example .env.staging
```

### 1.3. Générer une clé API forte

```bash
openssl rand -hex 32
```

Éditer `.env.staging` et remplacer `API_KEY` par la valeur générée.

### 1.4. Configurer le provider LLM

Pour validation initiale :

```bash
LLM_PROVIDER=mock
```

Pour tester avec un provider réel :

```bash
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
LLM_FALLBACK_ENABLED=false
```

**Important** : ne jamais commiter `.env.staging` dans Git.

### 1.5. Configurer le domaine TLS

Éditer `Caddyfile` et remplacer `staging.flash-archi.local` par votre domaine réel.

#### Option A : domaine public

Caddy obtiendra automatiquement un certificat Let's Encrypt.

#### Option B : domaine local (staging.flash-archi.local)

Installer mkcert :

```bash
# macOS
brew install mkcert
mkcert -install

# Linux
sudo apt install libnss3-tools
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
chmod +x mkcert-v*-linux-amd64
sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert
mkcert -install
```

Générer le certificat :

```bash
cd deploy/staging
mkcert staging.flash-archi.local
```

Modifier `Caddyfile` pour utiliser le certificat local :

```caddyfile
staging.flash-archi.local {
    tls cert.pem key.pem
    # ... reste inchangé
}
```

Ajouter dans `/etc/hosts` :

```
127.0.0.1 staging.flash-archi.local
```

---

## 2. Construction de l'image

```bash
cd deploy/staging
docker compose build
```

Vérifier :

```bash
docker images | grep flash-archi
```

Attendu :

```
flash-archi  3.3.0  ...  ...  ...
```

---

## 3. Démarrage

```bash
docker compose up -d
```

Vérifier les services :

```bash
docker compose ps
```

Attendu :

```
NAME                STATUS              PORTS
staging-api-1       Up (healthy)        
staging-caddy-1     Up                  0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
```

Suivre les logs :

```bash
docker compose logs -f api
```

Attendu : logs JSON avec `service: flash-archi`, `level`, `msg`, `requestId`.

---

## 4. Vérification santé

### Health check

```bash
curl -fsS https://staging.flash-archi.local/healthz
```

Attendu :

```json
{"api":"ok","provider":"mock","version":"3.3.0"}
```

### Readiness check

```bash
curl -fsS https://staging.flash-archi.local/readyz
```

Attendu :

```json
{"status":"ready","checks":{"database":"ok"}}
```

### Version

```bash
curl -fsS https://staging.flash-archi.local/version
```

Attendu :

```json
{"service":"flash-archi","version":"3.3.0","environment":"staging"}
```

---

## 5. Smoke test

Exécuter le script de validation :

```bash
chmod +x smoke-test.sh
BASE_URL=https://staging.flash-archi.local API_KEY=<votre-clé> ./smoke-test.sh
```

Le script valide :

1. `/healthz`, `/readyz`, `/version`
2. Auth refusée sans clé → 401
3. Auth refusée avec clé invalide → 401
4. Auth valide avec clé → 200
5. Génération mock → job créé
6. Headers rate limiting
7. TLS actif

---

## 6. Test de génération complet

```bash
export API_KEY="<votre-clé>"
export BASE_URL="https://staging.flash-archi.local"

JOB_ID=$(curl -fsS -X POST "$BASE_URL/api/flash-archi/generate" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"villa 150m² 3 chambres 2 étages toit plat","parameters":{"levels":2}}' \
  | jq -r '.jobId')

echo "Job créé : $JOB_ID"

# Attendre quelques secondes
sleep 5

# Consulter le résultat
curl -fsS "$BASE_URL/api/flash-archi/jobs/$JOB_ID" \
  -H "Authorization: Bearer $API_KEY" | jq .
```

Vérifier :

- `status: "completed"`
- `result.bimMetrics` présent
- `result.artifacts` contient `svg`, `png`, `ifc`

---

## 7. Backup et restauration

### Déclencher un backup manuel

```bash
docker compose exec api node scripts/backup-db.js
```

Vérifier le fichier créé :

```bash
docker compose exec api ls -lh /backups/
```

### Restaurer depuis un backup

```bash
docker compose exec api node scripts/restore-db.js /backups/flash-archi-YYYY-MM-DD-HHMM.db
```

Vérifier l'intégrité :

```bash
curl -fsS "$BASE_URL/api/flash-archi/jobs?limit=5" \
  -H "Authorization: Bearer $API_KEY" | jq .
```

---

## 8. Arrêt et nettoyage

### Arrêt propre

```bash
docker compose down
```

Les volumes `data` et `backups` sont conservés.

### Nettoyage complet (⚠ DESTRUCTIF)

```bash
docker compose down -v
```

Cela supprime les volumes (base de données + backups).

---

## 9. Dépannage

### Le service ne démarre pas

```bash
docker compose logs api
```

Vérifier :

- `.env.staging` présent et bien formé
- `API_KEY` définie
- `DB_PATH` pointe vers un chemin accessible
- Pas de conflit de port 8094

### /healthz répond 500

Vérifier les logs :

```bash
docker compose logs api | grep ERROR
```

Causes possibles :

- Base de données corrompue
- Provider LLM inaccessible (si non-mock)
- Variable d'environnement manquante

### Auth refusée même avec bonne clé

Vérifier que `AUTH_ENABLED=true` et que la clé dans `.env.staging` correspond exactement à celle utilisée dans `Authorization: Bearer <clé>`.

### Rate limit trop agressif

Éditer `.env.staging` :

```bash
RATE_LIMIT_MAX_PER_IP=120
RATE_LIMIT_GENERATION_MAX_PER_HOUR=10
```

Redémarrer :

```bash
docker compose restart api
```

### SSE ne fonctionne pas

Vérifier que `Caddyfile` contient `flush_interval -1`.

### Certificat TLS refusé

Si certificat auto-signé local, utiliser `curl -k` pour tests uniquement.

Pour production, toujours utiliser un certificat valide.

---

## 10. Checklist de validation

Avant de considérer le staging validé :

- [ ] `docker compose ps` montre api healthy
- [ ] `/healthz` répond 200
- [ ] `/readyz` répond 200 avec `database: ok`
- [ ] `/version` renvoie `3.3.0`
- [ ] Requête sans clé → 401
- [ ] Requête avec clé invalide → 401
- [ ] Requête avec clé valide → 200/202
- [ ] Génération mock complète → IFC + metrics
- [ ] Logs JSON visibles avec `requestId`
- [ ] `Authorization` masqué dans les logs
- [ ] Backup manuel fonctionne
- [ ] Restauration testée avec succès
- [ ] TLS actif (HTTPS)
- [ ] HTTP redirige vers HTTPS
- [ ] Rate limiting headers présents
- [ ] Smoke test passe entièrement

---

## 11. Prochaines étapes (P1)

Une fois le staging validé, les améliorations recommandées sont :

1. Migration PostgreSQL (multi-tenant, scalabilité)
2. Queue + worker (Redis/BullMQ ou PgBoss)
3. Stockage objet des artefacts (S3/MinIO)
4. Table `api_keys` avec scopes et quotas
5. Métriques Prometheus + dashboard Grafana
6. Alerting (Alertmanager ou équivalent)
7. Tests de charge (k6)
8. CI/CD automatisé (GitHub Actions, GitLab CI)

---

## Support

Pour toute question sur ce déploiement staging :

- Consulter `RUNBOOK.md` pour l'exploitation quotidienne
- Consulter `SECURITY.md` pour la politique de sécurité
- Consulter `BACKUP_RESTORE.md` pour les procédures de sauvegarde