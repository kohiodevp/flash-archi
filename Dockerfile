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

# Créer utilisateur non-root
RUN addgroup -S app && \
    adduser -S app -G app && \
    mkdir -p /app/data /backups && \
    chown -R app:app /app /backups

# Volumes pour données persistantes
VOLUME ["/app/data", "/backups"]

# Basculer vers utilisateur non-root
USER app

# Port exposé (interne seulement, proxy devant)
EXPOSE 8094

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8094/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Démarrage
CMD ["node", "src/index.js"]