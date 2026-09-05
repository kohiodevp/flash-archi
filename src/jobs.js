// ===========================================================
// Flash-Archi SaaS — Store de jobs (SQLite) + manager
// ===========================================================
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { config, PROJECT_ROOT } from './config.js'

export const JOB_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
})

export class JobStore {
  constructor(dbPath) {
    this.memoryOnly = !dbPath || dbPath === '' || dbPath === ':memory:'
    if (this.memoryOnly) {
      this.db = new Database(':memory:')
    } else {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
      this.db = new Database(dbPath)
      this.db.pragma('journal_mode = WAL')
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id         TEXT PRIMARY KEY,
        prompt     TEXT NOT NULL,
        status     TEXT NOT NULL,
        result     TEXT,
        error      TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    `)
  }

  create(prompt) {
    const id = `job_${randomUUID()}`
    const now = Date.now()
    const row = { id, prompt, status: JOB_STATUS.PENDING, created_at: now, updated_at: now }
    this.db
      .prepare('INSERT INTO jobs (id, prompt, status, created_at, updated_at) VALUES (@id, @prompt, @status, @created_at, @updated_at)')
      .run(row)
    return this.serialize(this.get(id))
  }

  get(id) {
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)
  }

  updateStatus(id, status, { result, error } = {}) {
    const patch = { error }
    if (result !== undefined) patch.result = JSON.stringify(result)
    const sets = ['status = @status', 'updated_at = @updatedAt']
    if (patch.error !== undefined) sets.push('error = @error')
    if (patch.result !== undefined) sets.push('result = @result')
    this.db
      .prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = @id`)
      .run({ id, status, updatedAt: Date.now(), error: patch.error ?? null, result: patch.result ?? null })
    return this.serialize(this.get(id))
  }

  list(limit = 20, offset = 0) {
    const rows = this.db
      .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset)
    return rows.map((r) => this.serialize(r))
  }

  serialize(row) {
    if (!row) return undefined
    const { result, ...rest } = row
    return {
      id: rest.id,
      status: rest.status,
      result: result ? JSON.parse(result) : undefined,
      error: rest.error ?? undefined,
      prompt: rest.prompt,
      createdAt: rest.created_at,
      updatedAt: rest.updated_at,
    }
  }

  /** Version publique (sans le prompt complet — ne pas exposer la saisie brute). */
  publicView(row) {
    const s = this.serialize(row)
    if (!s) return undefined
    return { id: s.id, status: s.status, result: s.result, error: s.error, createdAt: s.createdAt, updatedAt: s.updatedAt }
  }

  close() {
    this.db.close()
  }
}

// Store partagé par toute l'application.
export const jobStore = new JobStore(config.db.path)

/** Emet un événement aux écouteurs SSE d'un job. */
const listeners = new Map() // jobId -> Set<fn>

export function subscribe(jobId, fn) {
  if (!listeners.has(jobId)) listeners.set(jobId, new Set())
  listeners.get(jobId).add(fn)
  return () => {
    listeners.get(jobId)?.delete(fn)
    if (listeners.get(jobId)?.size === 0) listeners.delete(jobId)
  }
}

export function emit(jobId, event) {
  for (const fn of listeners.get(jobId) ?? []) {
    try {
      fn(event)
    } catch {
      /* écouteurs best-effort */
    }
  }
}

export async function runJobAsync(runFn, jobId, prompt) {
  // runFn(prompt) -> result (async)
  jobStore.updateStatus(jobId, JOB_STATUS.PROCESSING)
  emit(jobId, { type: 'status', status: JOB_STATUS.PROCESSING })
  try {
    const result = await runFn(prompt)
    jobStore.updateStatus(jobId, JOB_STATUS.COMPLETED, { result })
    emit(jobId, { type: 'status', status: JOB_STATUS.COMPLETED, result })
    
    // Dispatch webhook for job.completed event
    // Note: In a real implementation, we would get the tenantId from the job context
    // For now, we'll use a placeholder - this would be integrated with the actual job context
    try {
      // Import webhook functions dynamically to avoid circular dependencies
      const { dispatchWebhook } = await import('./webhooks.js')
      // In a real implementation, we would extract tenantId from the job or request context
      // For standalone mode, we'll use a default tenantId of 1
      // In production, this would come from the authenticated user/session
      const { getMemoryDb } = await import('./middleware/db.js')
      const memDb = getMemoryDb()
      if (memDb) {
        // Dispatch via le store stateful standalone (couvert par les tests)
        await dispatchWebhook(1, 'job.completed', {
          jobId,
          status: 'completed',
          result: result,
          completedAt: new Date().toISOString()
        }, memDb)
      } else {
        // Production/PostgreSQL : le pool est fourni par le contexte d'exécution réel.
        // (Sans accès au pool ici, on ne fait rien — le worker dédié prendra le relais.)
        console.debug('[webhook] job.completed dispatch skipped (no memory db)')
      }
    } catch (webhookErr) {
      // Don't let webhook failures affect the main job flow
      console.warn('[webhook] Failed to dispatch job.completed webhook:', webhookErr.message)
    }
  } catch (e) {
    const error = e?.message ?? String(e)
    jobStore.updateStatus(jobId, JOB_STATUS.FAILED, { error })
    emit(jobId, { type: 'status', status: JOB_STATUS.FAILED, error })
    
    // Dispatch webhook for job.failed event
    try {
      const { dispatchWebhook } = await import('./webhooks.js')
      const { getMemoryDb } = await import('./middleware/db.js')
      const memDb = getMemoryDb()
      if (memDb) {
        await dispatchWebhook(1, 'job.failed', {
          jobId,
          status: 'failed',
          error: error,
          failedAt: new Date().toISOString()
        }, memDb)
      }
    } catch (webhookErr) {
      console.warn('[webhook] Failed to dispatch job.failed webhook:', webhookErr.message)
    }
    // Ne pas rejeter : le job porte l'échec.
  }
}

export function resolveJobIdSegment(decodedSegment) {
  // La route exprime le path decode de l'id (/api/flash-archi/jobs/<id>).
  return decodeURIComponent(decodedSegment).replace(/\/$/, '')
}