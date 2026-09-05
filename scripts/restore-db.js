// scripts/restore-db.js — Restauration d'une sauvegarde SQLite
// Usage : node scripts/restore-db.js <backup-file>
import fs from 'node:fs'
import path from 'node:path'

const backupFile = process.argv[2]
if (!backupFile) {
  console.error('Usage : node scripts/restore-db.js <backup-file>')
  process.exit(1)
}
if (!fs.existsSync(backupFile)) {
  console.error(`Backup file not found: ${backupFile}`)
  process.exit(1)
}
if (backupFile.includes('../') || backupFile.includes('..\\')) {
  console.error('Chemin de backup invalide.')
  process.exit(1)
}

const dbPath = process.env.DB_PATH || './data/flash-archi.db'
fs.mkdirSync(path.dirname(dbPath), { recursive: true })

if (fs.existsSync(dbPath)) {
  fs.copyFileSync(dbPath, `${dbPath}.before-restore.${Date.now()}`)
}
fs.copyFileSync(backupFile, dbPath)
console.log(`Restore completed: ${backupFile} -> ${dbPath}`)