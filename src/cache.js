// ===========================================================
// Flash-Archi SaaS — Cache réponse (mémoire + SQLite)
// ===========================================================
import { createHash } from 'node:crypto'
import { config } from './config.js'

export function makeCacheKey(provider, model, system, user) {
  return createHash('sha256').update(JSON.stringify({ provider, model, system, user })).digest('hex')
}

/** Cache mémoire simple avec TTL et limite d'entrées. */
export class MemoryCache {
  constructor({ ttlMs = config.cache.ttlMs, maxEntries = config.cache.maxEntries } = {}) {
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
    this.map = new Map() // key -> { value, stamp }
  }

  async get(key) {
    const entry = this.map.get(key)
    if (!entry) return null
    if (Date.now() - entry.stamp > this.ttlMs) {
      this.map.delete(key)
      return null
    }
    return entry.value
  }

  async set(key, value) {
    if (this.map.size >= this.maxEntries) {
      // Éviction du plus ancien.
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, { value, stamp: Date.now() })
  }
}

export const cache = new MemoryCache()