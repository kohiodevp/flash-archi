FROM node:20-alpine

LABEL maintainer="Flash-Archi Team"
LABEL version="3.3.0"
LABEL description="Flash-Archi API - Générateur architectural IA"

ENV NODE_ENV=production

WORKDIR /app

# Copier package files
COPY package*.json ./

# Installer dépendances production uniquement
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copier le code source
COPY src ./src
COPY scripts ./scripts
# OpenAPI spec chargée au démarrage (app.js → openapi/spec.yaml) — indispensable
COPY openapi ./openapi

# Créer utilisateur non-root
RUN addgroup -S app && \
    adduser -S app -G app && \
    mkdir -p /app/data /backups && \
    chown -R app:app /app /backups

# Volumes pour données persistantes
VOLUME ["/app/data", "/backups"]

# Basculer vers utilisateur non-root
USER app

# Port interne réel : le serveur écoute sur config.server.port = PORT (8080)
EXPOSE 8080

# Health check (aligné sur PORT ; le compose peut redéclarer un healthcheck)
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Démarrage
CMD ["node", "src/index.js"]