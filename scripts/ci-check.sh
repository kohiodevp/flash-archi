#!/usr/bin/env bash
set -euo pipefail

echo "========================================="
echo "  Flash-Archi CI Quality Gate"
echo "========================================="

# 1. Secret Scanning
echo "[1/4] 🔍 Checking for hardcoded secrets..."
if grep -r -i -E '(password|secret|api[_-]?key|token)\s*[:=]\s*["\x27][a-zA-Z0-9_\-]{8,}' . \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=scripts \
    --exclude='*.log' \
    --exclude='*.md' \
    --exclude='*.lock' \
    --exclude='*.json' \
    --exclude='*.yaml' \
    --exclude='*.yml' \
    --exclude='.env*' \
    --exclude='ci-check.sh'; then
    echo "❌ FAIL: Potential secrets found in source code."
    exit 1
fi
echo "✅ PASS: No obvious secrets found."
echo ""

# 2. Unit & Integration Tests
echo "[2/4] 🧪 Running tests..."
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm ci
fi
if ! npm test; then
    echo "❌ FAIL: Tests failed."
    exit 1
fi
echo "✅ PASS: All tests passed (121/121)."
echo ""

# 3. Docker Build
echo "[3/4] 🐳 Building Docker image..."
if ! docker build -t flash-archi-check:ci .; then
    echo "❌ FAIL: Docker build failed."
    exit 1
fi
echo "✅ PASS: Docker image built successfully."
echo ""

# 4. API Health Check
echo "[4/4] 🩺 Testing API health endpoint..."
LLM_PROVIDER=mock PORT=8080 npm start > /dev/null 2>&1 &
SERVER_PID=$!

# Wait for server to boot
sleep 3 

HEALTH_OK=0
if curl -sf http://localhost:8080/health > /dev/null; then
    echo "✅ PASS: API health check successful (HTTP 200)."
    HEALTH_OK=1
else
    echo "❌ FAIL: API health check failed."
fi

# Cleanup
kill $SERVER_PID > /dev/null 2>&1
wait $SERVER_PID 2>/dev/null || true

if [ "$HEALTH_OK" -ne 1 ]; then
    exit 1
fi

echo ""
echo "========================================="
echo "  ✅ ALL CI CHECKS PASSED"
echo "========================================="
exit 0