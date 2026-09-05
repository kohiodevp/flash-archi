#!/usr/bin/env node
// ===========================================================
// Flash-Archi SaaS — Point d'entrée serveur
// ===========================================================
import { config } from './config.js'
import app from './app.js'

// Le store job est initialisé à l'import ; on s'assure que son
// répertoire est prêt (DB_PATH peut être relative à .env).
import { jobStore } from './jobs.js'

const { port, host } = config.server

const server = app.listen(port, host, () => {
  console.log(`[flash-archi-saas] API disponible sur http://${host}:${port}`)
  console.log(`[flash-archi-saas] /health · /api/flash-archi/generate · /api/flash-archi/jobs · /api/flash-archi/jobs/:id · /api/flash-archi/events/:id`)
  console.log(`[flash-archi-saas] provider=${config.llm.provider} · model=${config.llm.model}`)
  console.log(`[flash-archi-saas] jobs store=${jobStore.memoryOnly ? 'mémoire' : config.db.path}`)
})

const shutdown = () => {
  console.log('\n[flash-archi-saas] Arrêt. Fermeture des ressources...')
  try {
    jobStore.close()
  } finally {
    server.close(() => process.exit(0))
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)