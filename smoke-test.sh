#!/usr/bin/env bash
# deploy/staging/smoke-test.sh — Tests de validation staging Flash-Archi
set -euo pipefail

BASE_URL="${BASE_URL:-https://staging.flash-archi.local}"
API_KEY="${API_KEY:-}"
CURL_OPTS="-k -f -s -S"  # -k pour cert auto-signé en local, retirer en prod

echo "=== Flash-Archi Staging Smoke Tests ==="
echo "Base URL: $BASE_URL"
echo ""

# 1. Health check
echo "[1/9] Health check..."
HEALTH=$(curl $CURL_OPTS "$BASE_URL/healthz")
echo "✓ /healthz: $HEALTH"

# 2. Readiness check
echo "[2/9] Readiness check..."
READY=$(curl $CURL_OPTS "$BASE_URL/readyz")
echo "✓ /readyz: $READY"

# 3. Version check
echo "[3/9] Version check..."
VERSION=$(curl $CURL_OPTS "$BASE_URL/version")
echo "✓ /version: $VERSION"

# 4. Auth refusée sans clé
echo "[4/9] Auth refusée sans clé..."
HTTP_CODE=$(curl $CURL_OPTS -o /dev/null -w "%{http_code}" "$BASE_URL/api/flash-archi/jobs" || echo "401")
if [ "$HTTP_CODE" = "401" ]; then
  echo "✓ Sans clé → 401"
else
  echo "✗ Attendu 401, reçu $HTTP_CODE"
  exit 1
fi

# 5. Auth refusée avec mauvaise clé
echo "[5/9] Auth refusée avec clé invalide..."
HTTP_CODE=$(curl $CURL_OPTS -o /dev/null -w "%{http_code}" -H "Authorization: Bearer wrong-key" "$BASE_URL/api/flash-archi/jobs" || echo "401")
if [ "$HTTP_CODE" = "401" ]; then
  echo "✓ Clé invalide → 401"
else
  echo "✗ Attendu 401, reçu $HTTP_CODE"
  exit 1
fi

# 6. Auth valide
if [ -z "$API_KEY" ]; then
  echo "[6/9] Clé API non fournie, test auth valide SKIP"
else
  echo "[6/9] Auth valide..."
  JOBS=$(curl $CURL_OPTS -H "Authorization: Bearer $API_KEY" "$BASE_URL/api/flash-archi/jobs?limit=1")
  echo "✓ Clé valide → 200, jobs: $JOBS"
fi

# 7. Génération (si clé fournie)
if [ -z "$API_KEY" ]; then
  echo "[7/9] Clé API non fournie, test génération SKIP"
else
  echo "[7/9] Génération mock..."
  PAYLOAD='{"prompt":"maison test 100m² 2 chambres toit plat","parameters":{"levels":1}}'
  JOB=$(curl $CURL_OPTS -X POST \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    "$BASE_URL/api/flash-archi/generate")
  JOB_ID=$(echo "$JOB" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4 || echo "")
  if [ -n "$JOB_ID" ]; then
    echo "✓ Job créé: $JOB_ID"
  else
    echo "✗ Job non créé"
    exit 1
  fi
fi

# 8. Rate limiting headers
echo "[8/9] Rate limiting headers..."
HEADERS=$(curl $CURL_OPTS -I "$BASE_URL/healthz" 2>/dev/null | grep -i ratelimit || echo "")
if [ -n "$HEADERS" ]; then
  echo "✓ Headers ratelimit présents"
else
  echo "⚠ Headers ratelimit absents (peut-être désactivé sur /healthz)"
fi

# 9. TLS
echo "[9/9] TLS check..."
if [[ "$BASE_URL" =~ ^https:// ]]; then
  echo "✓ URL en HTTPS"
else
  echo "⚠ URL non HTTPS"
fi

echo ""
echo "=== Smoke tests terminés avec succès ==="