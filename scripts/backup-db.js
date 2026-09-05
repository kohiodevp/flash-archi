// scripts/backup-db.js — Sauvegarde sûre de la base SQLite (via better-sqlite3 .backup)
// Usage : node scripts/backup-db.js
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const dbPath = process.env.DB_PATH || './data/flash-archi.db'
const backupDir = process.env.BACKUP_DIR || './backups'
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupFile = path.join(backupDir, `flash-archi-${timestamp}.db`)

if (dbPath === ':memory:' || dbPath === '') {
  console.error('Backup impossible : la base est en mémoire (DB_PATH vide ou :memory:).')
  process.exit(1)
}

fs.mkdirSync(backupDir, { recursive: true })

async function main() {
  const db = new Database(dbPath)
  try {
    // .backup() est asynchrone : attendre la fin AVANT de fermer la connexion.
    await db.backup(backupFile)
    console.log(`Backup created: ${backupFile}`)
  } finally {
    db.close()
  }
}

main().catch((err) => {
  console.error('Backup failed:', err?.message ?? err)
  process.exit(1)
})