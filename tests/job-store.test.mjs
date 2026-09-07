// tests/job-store.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JobStore, JOB_STATUS } from '../src/jobs.js'

function makeStore() { return new JobStore(':memory:') }

test('normalizePrompt : fusionne casse/ponctuation/espaces', () => {
  const s = makeStore()
  const a = s.hashPrompt('Villa de 120m² avec 4 chambres style contemporain')
  const b = s.hashPrompt('VILLA 120m² 4 chambres, style contemporain.')
  assert.equal(a, b)
})

test('normalizePrompt : invariant aux accents', () => {
  const s = makeStore()
  assert.equal(s.hashPrompt('méditerranéen'), s.hashPrompt('mediterraneen'))
})

test('normalizePrompt : mots ordonnés (ordre indifférent)', () => {
  const s = makeStore()
  assert.equal(s.hashPrompt('villa 120m2 contemporain'), s.hashPrompt('contemporain villa 120m2'))
})

test('findCached : renvoie le job complété pour une variante équivalente', () => {
  const s = makeStore()
  const seed = 'Villa de 120m² avec 4 chambres style contemporain'
  const j = s.create(seed)
  s.updateStatus(j.id, JOB_STATUS.COMPLETED, { result: { spec: { surface: 120 } } })
  s.saveCache(seed, j.id)

  // Variante équivalente : casse + ponctuation + 120m2 vs 120 m2.
  const hit = s.findCached('VILLA 120 m2, 4 chambres, style CONTEMPORAIN !')
  assert.ok(hit, 'cache hit attendu')
  assert.equal(hit.status, 'completed')
  assert.equal(hit.result.spec.surface, 120)
})

test('findCached : miss pour un prompt différent', () => {
  const s = makeStore()
  const j = s.create('villa 120m2')
  s.updateStatus(j.id, JOB_STATUS.COMPLETED, { result: { spec: {} } })
  s.saveCache('villa 120m2', j.id)
  assert.equal(s.findCached('entrepot 500m2'), undefined)
})

test('findCached : miss si le job est failed ou pending', () => {
  const s = makeStore()
  // pending
  const jp = s.create('prompt pending')
  s.saveCache('prompt pending', jp.id)
  assert.equal(s.findCached('prompt pending'), undefined)
  // failed
  const jf = s.create('prompt failed')
  s.updateStatus(jf.id, JOB_STATUS.FAILED, { error: 'boom' })
  s.saveCache('prompt failed', jf.id)
  assert.equal(s.findCached('prompt failed'), undefined)
})

test('findCached : TTL expiré → miss (entrée purgée)', () => {
  const s = makeStore()
  const j = s.create('villa 120m2')
  s.updateStatus(j.id, JOB_STATUS.COMPLETED, { result: {} })
  s.saveCache('villa 120m2', j.id)
  // Force expiration
  s.db.prepare('UPDATE prompt_cache SET created_at = ?').run(Date.now() - 25 * 3600 * 1000)
  assert.equal(s.findCached('villa 120m2'), undefined)
})

test('create : status pending + id unique', () => {
  const s = makeStore()
  const a = s.create('x')
  const b = s.create('x')
  assert.notEqual(a.id, b.id)
  assert.equal(a.status, 'pending')
})