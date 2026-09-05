# ============================================================
# Flash-Archi — Configuration Nginx Proxy Manager (NPM)
# Déploiement Phase 4 — 2 Proxy Hosts derrière npm-net
# ============================================================

## IMPORTANT — réseau
- Les 2 conteneurs (`flash-archi-api`, `flash-archi-frontend`) DOIVENT
  être rattachés au réseau externe `npm-net` (docker network connect
  ou network: dans docker-compose externe). Vérifier :
    docker network inspect npm-net | grep flash-archi
- NPM (jc21/nginx-proxy-manager) doit être sur le même `npm-net`.

## PROXY HOST 1 — Frontend (SPA)
- Domain Names : `app.flash-archi.com`  (ou sous-domaine réel)
- Scheme        : `http`
- Forward Host  : `flash-archi-frontend`
- Forward Port  : `80`
- Options       : ☑ Block Common Exploits  · ☑ Websockets (SSE)
- SSL           : Request a new SSL Certificate → Let's Encrypt
                  + Force SSL + HTTP/2
- SPA fallback  : géré par le nginx du conteneur frontend
                  (`try_files $uri $uri/ /index.html`).

> NB sur le SSE : le suivi temps réel utilise `/api/**/events/:id`
> (text/event-stream). Activer le support websocket n'est pas
> strictement nécessaire pour une SSE (HTTP simple), mais ne gêne pas.

## PROXY HOST 2 — API (accès direct, recommandé pour les tests/dev)
- Domain Names : `api.flash-archi.com`
- Scheme        : `http`
- Forward Host  : `flash-archi-api`
- Forward Port  : `8080`
- Options       : ☑ Block Common Exploits
- SSL           : Request a new SSL Certificate + Force SSL + HTTP/2

### ⚠ ROUTAGE /api depuis le frontend
Le frontend appelle **`/api/**` en URL relative** (même hôte). Pour que
le navigateur atteigne l'API :
- OU un Custom Location sur le Proxy Host 1 :
    Location : `/api`
    Scheme    : http
    Forward   : `flash-archi-api`
    Port      : `8080`
  → NPM proxy `/api/*` vers l'API ; le reste reste la SPA.
- OU le domaine séparé `api.flash-archi.com` (si le frontend est
  configuré avec `VITE_API_BASE=https://api.flash-archi.com`).

Recommandation MVP : la **1ʳᵉ option** (Custom Location `/api` sur le
frontend) — un seul domaine, zéro CORS sur le chemin d'intégration.

## DNS
- `app.flash-archi.com` → A → <IP_DU_VPS>
- `api.flash-archi.com` → A → <IP_DU_VPS>
(Si pas de domaine : utiliser `app.<IP>.sslip.io` / `api.<IP>.sslip.io`.)

## Vérification après config NPM
    # depuis l'hôte (ou un conteneur npm-net)
    curl -s https://app.flash-archi.com/healthz          # → progress via API si /api routé
    curl -s https://app.flash-archi.com/                 # → index.html de la SPA
    # API directe
    curl -s https://api.flash-archi.com/health           # → {"api":"ok",...}
    # flux SSE
    curl -N https://app.flash-archi.com/api/flash-archi/events/<jobId> \
      -H "Authorization: Bearer $API_KEY"

## Sécurité (headres déjà ajoutés par le nginx du frontend)
X-Frame-Options SAMEORIGIN · X-Content-Type-Options nosniff
X-XSS-Protection 1; mode=block · Referrer-Policy strict-origin-when-cross-origin

## Rappel
- `AUTH_ENABLED=true` côté API (clé Bearer) — la clé vit dans
  `/home/betsa/flash-archi/.env` (API_KEY), jamais exposée.
- Frontend : la clé est saisie au runtime, gardée en sessionStorage.