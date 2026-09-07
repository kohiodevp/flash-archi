// ===========================================================
// Flash-Archi SaaS — File d'attente de génération (Phase 3B)
// Limite le nombre de générations simultanées (CPU limité) et
// expose la position d'un job dans la file (via les événements SSE).
// ===========================================================
import { JOB_STATUS, jobStore, emit } from './jobs.js'

export class JobQueue {
  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent
    this.running = 0
    this._queue = [] // [{ jobId, jobFn, resolve, reject }]
  }

  /** Nombre de jobs en attente (hors exécution en cours). */
  get length() { return this._queue.length }

  /** Position 1-based d'un job en file ; 0 = en cours ou absente. */
  getPosition(jobId) {
    const idx = this._queue.findIndex((item) => item.jobId === jobId)
    return idx === -1 ? 0 : idx + 1
  }

  /**
   * Encapsule l'exécution d'une génération dans la file bornée.
   * @param {string} jobId
   * @param {() => Promise<any>} jobFn Fonction qui lance la génération.
   * @returns {Promise<any>} résout avec le résultat.
   */
  enqueue(jobId, jobFn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ jobId, jobFn, resolve, reject })
      // Signale sa position en file (2/3, 4/10…) via SSE — après le push.
      const pos = this.getPosition(jobId)
      emit(jobId, { type: 'progress', stage: `En file d'attente…`, percent: 2, position: pos, queued: pos > 1 })
      this.#drain()
    })
  }

  #drain() {
    if (this.running >= this.maxConcurrent) return
    const item = this._queue.shift()
    if (!item) return

    this.running++
    const { jobId, jobFn, resolve, reject } = item
    // Passé de "pending/queued" à "processing" + signal position 0 (exécution).
    jobStore.updateStatus(jobId, JOB_STATUS.PROCESSING)
    emit(jobId, { type: 'progress', stage: 'Traitement en cours…', percent: 5, position: 0 })

    Promise.resolve()
      .then(() => jobFn())
      .then(resolve, reject)
      .finally(() => {
        this.running--
        this.#drain()
      })
  }
}

export default new JobQueue(3)